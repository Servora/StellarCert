import {
  Injectable,
  ConflictException,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as QRCode from 'qrcode';
import { CreateCertificateDto } from './dto/create-certificate.dto';
import { UpdateCertificateDto } from './dto/update-certificate.dto';
import { IssueCertificateDto } from './dto/issue-certificate.dto';
import { RevokeCertificateDto } from './dto/revoke-certificate.dto';
import { SearchCertificatesDto } from './dto/search-certificates.dto';
import { Certificate } from './entities/certificate.entity';
import { Verification } from './entities/verification.entity';
import { CertificateStatus } from './constants/certificate-status.enum';
import { User } from '../users/entities/user.entity';
import { DuplicateDetectionService } from './services/duplicate-detection.service';
import { DuplicateDetectionConfig } from './interfaces/duplicate-detection.interface';
import { WebhooksService } from '../webhooks/webhooks.service';
import { WebhookEvent } from '../webhooks/entities/webhook-subscription.entity';
import { MetadataSchemaService } from '../metadata-schema/services/metadata-schema.service';
import { UserRole } from '../users/entities/user.entity';
import { SorobanService } from '../stellar/services/soroban.service';

@Injectable()
export class CertificateService {
  private readonly logger = new Logger(CertificateService.name);
  private readonly enableSoroban: boolean;

  constructor(
    @InjectRepository(Certificate)
    private readonly certificateRepository: Repository<Certificate>,
    @InjectRepository(Verification)
    private readonly verificationRepository: Repository<Verification>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly duplicateDetectionService: DuplicateDetectionService,
    private readonly webhooksService: WebhooksService,
    private readonly metadataSchemaService: MetadataSchemaService,
    private readonly dataSource: DataSource,
    private readonly sorobanService: SorobanService,
  ) {}

  async create(
    dto: CreateCertificateDto,
    duplicateConfig?: DuplicateDetectionConfig,
    overrideReason?: string,
    ipAddress = 'unknown',
    userAgent = 'unknown',
  ): Promise<Certificate> {
    // Look up recipientId from email if not provided
    let recipientId = dto.recipientId;
    if (!recipientId && dto.recipientEmail) {
      const user = await this.userRepository.findOne({
        where: { email: dto.recipientEmail },
      });
      if (user) {
        recipientId = user.id;
      }
    }

    // Check for duplicates if config is provided
    if (duplicateConfig?.enabled) {
      const duplicateCheck =
        await this.duplicateDetectionService.checkForDuplicates(
          dto,
          duplicateConfig,
        );

      if (duplicateCheck.isDuplicate) {
        if (duplicateCheck.action === 'block') {
          throw new ConflictException({
            message: 'Certificate issuance blocked due to potential duplicate',
            details: duplicateCheck,
          });
        } else if (duplicateCheck.action === 'warn' && !overrideReason) {
          throw new ConflictException({
            message:
              'Warning: Potential duplicate detected. Override reason required.',
            details: duplicateCheck,
            requiresOverride: true,
          });
        }
      }
    }

    if (dto.metadataSchemaId && dto.metadata) {
      const validationResult = await this.metadataSchemaService.validate(
        dto.metadataSchemaId,
        dto.metadata,
      );
      if (!validationResult.valid) {
        throw new ConflictException({
          message: 'Certificate metadata failed schema validation',
          errors: validationResult.errors,
          schemaId: validationResult.schemaId,
          schemaVersion: validationResult.schemaVersion,
        });
      }
    }

    // Create a QueryRunner for transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const certificate = queryRunner.manager.create(Certificate, {
        ...dto,
        recipientId,
        certificateId: this.generateCertificateId(),
        expiresAt: dto.expiresAt || this.calculateDefaultExpiry(),
        verificationCode:
          dto.verificationCode || this.generateVerificationCode(),
        isDuplicate: false,
      });
      // TypeORM quirk: dual @Column()/@ManyToOne() on same column name — set issuerId directly
      if (dto.issuerId) {
        (certificate as any).issuerId = dto.issuerId;
      }

      const savedCertificate = await queryRunner.manager.save(certificate);

      // If this was an override, mark it appropriately
      if (overrideReason) {
        savedCertificate.isDuplicate = true;
        savedCertificate.overrideReason = overrideReason;
        await queryRunner.manager.save(savedCertificate);
      }

      // Commit the transaction
      await queryRunner.commitTransaction();

      this.logger.log(
        `Certificate created: ${savedCertificate.id} for ${dto.recipientEmail}`,
      );

      // ── Issue on-chain ────────────────────────────────────────────────────
      // Attempt to record the certificate on the Soroban contract.  The DB
      // record is committed first so it is never lost on a transient RPC
      // error.  If Soroban is not configured (e.g. in test/dev environments)
      // the call is skipped and a warning is logged.  If the on-chain call
      // fails we surface the error to the caller so they are aware the DB and
      // the chain are out of sync — callers can retry via the dedicated
      // stellar endpoint.
      if (this.sorobanService.isConfigured()) {
        try {
          const metadataUri =
            savedCertificate.verificationCode ?? savedCertificate.id;
          const issuerAddress = savedCertificate.issuerStellarAddress ?? '';
          const ownerAddress = savedCertificate.recipientStellarAddress ?? '';

          if (!issuerAddress || !ownerAddress) {
            this.logger.warn(
              `Certificate ${savedCertificate.id}: missing Stellar addresses — skipping on-chain issuance`,
            );
          } else {
            const expiresAtUnix = savedCertificate.expiresAt
              ? Math.floor(savedCertificate.expiresAt.getTime() / 1000)
              : undefined;

            const txHash = await this.sorobanService.issueCertificate(
              savedCertificate.id,
              issuerAddress,
              ownerAddress,
              metadataUri,
              expiresAtUnix,
            );

            if (!txHash) {
              throw new InternalServerErrorException(
                `On-chain issuance failed for certificate ${savedCertificate.id}`,
              );
            }

            // Persist the Stellar transaction hash so callers can verify on-chain
            await this.certificateRepository.update(savedCertificate.id, {
              stellarTransactionHash:
                typeof txHash === 'string' ? txHash : undefined,
            });

            if (typeof txHash === 'string') {
              savedCertificate.stellarTransactionHash = txHash;
            }

            this.logger.log(
              `Certificate ${savedCertificate.id} issued on-chain`,
            );
          }
        } catch (blockchainError: any) {
          // Log the failure but do NOT silently swallow it — the certificate
          // exists in the DB without a corresponding on-chain record, which is
          // the bug described in issue #523.  Re-throw so the caller knows.
          this.logger.error(
            `On-chain issuance failed for certificate ${savedCertificate.id}: ${blockchainError.message}`,
            blockchainError.stack,
          );
          throw blockchainError;
        }
      } else {
        this.logger.warn(
          'SorobanService is not configured — certificate saved to DB only (no on-chain record)',
        );
      }
      // ── End on-chain issuance ─────────────────────────────────────────────

      // Trigger webhook event (outside transaction)
      await this.webhooksService.triggerEvent(
        WebhookEvent.CERTIFICATE_ISSUED,
        savedCertificate.issuerId,
        {
          id: savedCertificate.id,
          recipientEmail: savedCertificate.recipientEmail,
          recipientName: savedCertificate.recipientName,
          title: savedCertificate.title,
          issuedAt: savedCertificate.issuedAt,
          status: savedCertificate.status,
        },
      );

      return savedCertificate;
    } catch (error) {
      // Rollback transaction on error
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to create certificate: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      // Release the QueryRunner
      await queryRunner.release();
    }
  }

  async findAll(
    page = 1,
    limit = 10,
    issuerId?: string,
    status?: string,
  ): Promise<{ certificates: Certificate[]; total: number }> {
    const queryBuilder = this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .orderBy('certificate.issuedAt', 'DESC');

    if (issuerId) {
      queryBuilder.andWhere('certificate.issuerId = :issuerId', { issuerId });
    }

    if (status) {
      queryBuilder.andWhere('certificate.status = :status', { status });
    }

    const total = await queryBuilder.getCount();
    const certificates = await queryBuilder
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return { certificates, total };
  }

  async findOne(id: string): Promise<Certificate> {
    const certificate = await this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .where('certificate.id = :id', { id })
      .getOne();

    if (!certificate) {
      throw new NotFoundException(`Certificate with ID ${id} not found`);
    }

    return certificate;
  }

  async findByVerificationCode(verificationCode: string): Promise<Certificate> {
    const certificate = await this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .where('certificate.verificationCode = :verificationCode', {
        verificationCode,
      })
      .andWhere('certificate.status = :status', { status: 'active' })
      .getOne();

    if (!certificate) {
      // Record failed verification if we want to track it
      throw new NotFoundException(
        'Certificate not found or invalid verification code',
      );
    }

    return certificate;
  }

  async verifyCertificate(verificationCode: string): Promise<Certificate> {
    try {
      const certificate = await this.findByVerificationCode(verificationCode);

      // Record successful verification
      await this.verificationRepository.save({
        certificate,
        success: true,
        verifiedAt: new Date(),
      });

      // Trigger webhook event
      await this.webhooksService.triggerEvent(
        WebhookEvent.CERTIFICATE_VERIFIED,
        certificate.issuerId,
        {
          id: certificate.id,
          verificationCode,
          verifiedAt: new Date(),
          recipientEmail: certificate.recipientEmail,
        },
      );

      return certificate;
    } catch (error) {
      if (error instanceof NotFoundException) {
        // Option: Record failed verification in DB too
      }
      throw error;
    }
  }

  async update(
    id: string,
    updateCertificateDto: UpdateCertificateDto,
  ): Promise<Certificate> {
    const certificate = await this.findOne(id);

    Object.assign(certificate, updateCertificateDto);

    return this.certificateRepository.save(certificate);
  }

  async revoke(id: string, reason?: string): Promise<Certificate> {
    const certificate = await this.findOne(id);

    certificate.status = CertificateStatus.REVOKED;
    if (reason) {
      certificate.metadata = {
        ...certificate.metadata,
        revocationReason: reason,
        revokedAt: new Date(),
      };
    }

    const savedCertificate = await this.certificateRepository.save(certificate);

    // Trigger webhook event
    await this.webhooksService.triggerEvent(
      WebhookEvent.CERTIFICATE_REVOKED,
      savedCertificate.issuerId,
      {
        id: savedCertificate.id,
        status: savedCertificate.status,
        revocationReason: reason,
        revokedAt: new Date(),
      },
    );

    return savedCertificate;
  }

  async freeze(
    id: string,
    reason?: string,
    durationDays?: number,
  ): Promise<Certificate> {
    const certificate = await this.findOne(id);

    if (certificate.status !== CertificateStatus.ACTIVE) {
      throw new ConflictException(
        `Certificate must be active to freeze. Current status: ${certificate.status}`,
      );
    }

    const frozenAt = new Date();
    const normalizedDurationDays =
      typeof durationDays === 'number' && Number.isFinite(durationDays)
        ? Math.max(1, Math.trunc(durationDays))
        : undefined;
    const unfreezeAt = normalizedDurationDays
      ? new Date(
          frozenAt.getTime() + normalizedDurationDays * 24 * 60 * 60 * 1000,
        )
      : undefined;

    certificate.status = CertificateStatus.FROZEN;
    certificate.metadata = {
      ...certificate.metadata,
      ...(reason ? { freezeReason: reason } : {}),
      frozenAt,
      ...(normalizedDurationDays
        ? { freezeDurationDays: normalizedDurationDays }
        : {}),
      ...(unfreezeAt ? { unfreezeAt } : {}),
    };

    const savedCertificate = await this.certificateRepository.save(certificate);

    // Trigger webhook event
    await this.webhooksService.triggerEvent(
      WebhookEvent.CERTIFICATE_REVOKED, // Using existing revoked event, could add new freeze event
      savedCertificate.issuerId,
      {
        id: savedCertificate.id,
        status: savedCertificate.status,
        ...(reason ? { freezeReason: reason } : {}),
        frozenAt,
        ...(normalizedDurationDays
          ? { freezeDurationDays: normalizedDurationDays }
          : {}),
        ...(unfreezeAt ? { unfreezeAt } : {}),
      },
    );

    return savedCertificate;
  }

  async unfreeze(id: string, reason?: string): Promise<Certificate> {
    const certificate = await this.findOne(id);

    if (certificate.status !== CertificateStatus.FROZEN) {
      throw new ConflictException(
        `Certificate must be frozen to unfreeze. Current status: ${certificate.status}`,
      );
    }

    certificate.status = CertificateStatus.ACTIVE;
    if (reason) {
      certificate.metadata = {
        ...certificate.metadata,
        unfreezeReason: reason,
        unfrozenAt: new Date(),
      };
    }

    const savedCertificate = await this.certificateRepository.save(certificate);

    // Trigger webhook event
    await this.webhooksService.triggerEvent(
      WebhookEvent.CERTIFICATE_ISSUED, // Using existing issued event, could add new unfreeze event
      savedCertificate.issuerId,
      {
        id: savedCertificate.id,
        status: savedCertificate.status,
        unfreezeReason: reason,
        unfrozenAt: new Date(),
      },
    );

    return savedCertificate;
  }

  async bulkRevoke(
    certificateIds: string[],
    reason?: string,
    issuerId?: string,
    userRole?: string,
  ): Promise<{
    revoked: Certificate[];
    failed: { id: string; error: string }[];
  }> {
    const revoked: Certificate[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const id of certificateIds) {
      try {
        const certificate = await this.findOne(id);

        if (userRole !== UserRole.ADMIN) {
          if (!issuerId) {
            failed.push({
              id,
              error: 'Issuer identity is required to revoke certificate',
            });
            continue;
          }

          if (certificate.issuerId !== issuerId) {
            failed.push({
              id,
              error:
                'Unauthorized to revoke certificate issued by another issuer',
            });
            continue;
          }
        }

        const revokedCertificate = await this.revoke(id, reason);
        revoked.push(revokedCertificate);
      } catch (error) {
        failed.push({
          id,
          error: error.message || 'Failed to revoke certificate',
        });
      }
    }

    return { revoked, failed };
  }

  async exportCertificates(
    issuerId?: string,
    status?: string,
  ): Promise<Certificate[]> {
    const queryBuilder = this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .orderBy('certificate.issuedAt', 'DESC');

    if (issuerId) {
      queryBuilder.andWhere('certificate.issuerId = :issuerId', { issuerId });
    }

    if (status) {
      queryBuilder.andWhere('certificate.status = :status', { status });
    }

    return queryBuilder.getMany();
  }

  async bulkExport(certificateIds: string[], filters?: any): Promise<string> {
    const queryBuilder = this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .orderBy('certificate.issuedAt', 'DESC');

    // Apply certificate ID filter if provided
    if (certificateIds && certificateIds.length > 0) {
      queryBuilder.andWhere('certificate.id IN (:...certificateIds)', {
        certificateIds,
      });
    }

    // Apply additional filters
    if (filters) {
      if (filters.search) {
        queryBuilder.andWhere(
          '(certificate.serialNumber ILIKE :search OR certificate.recipientName ILIKE :search OR certificate.recipientEmail ILIKE :search OR certificate.title ILIKE :search)',
          { search: `%${filters.search}%` },
        );
      }

      if (filters.status) {
        queryBuilder.andWhere('certificate.status = :status', {
          status: filters.status,
        });
      }

      if (filters.startDate) {
        queryBuilder.andWhere('certificate.issuedAt >= :startDate', {
          startDate: new Date(filters.startDate),
        });
      }

      if (filters.endDate) {
        queryBuilder.andWhere('certificate.issuedAt <= :endDate', {
          endDate: new Date(filters.endDate),
        });
      }
    }

    const certificates = await queryBuilder.getMany();
    return this.convertToCSV(certificates);
  }

  async exportAllFiltered(filters?: any): Promise<string> {
    const queryBuilder = this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .orderBy('certificate.issuedAt', 'DESC');

    // Apply filters
    if (filters) {
      if (filters.search) {
        queryBuilder.andWhere(
          '(certificate.serialNumber ILIKE :search OR certificate.recipientName ILIKE :search OR certificate.recipientEmail ILIKE :search OR certificate.title ILIKE :search)',
          { search: `%${filters.search}%` },
        );
      }

      if (filters.status) {
        queryBuilder.andWhere('certificate.status = :status', {
          status: filters.status,
        });
      }

      if (filters.startDate) {
        queryBuilder.andWhere('certificate.issuedAt >= :startDate', {
          startDate: new Date(filters.startDate),
        });
      }

      if (filters.endDate) {
        queryBuilder.andWhere('certificate.issuedAt <= :endDate', {
          endDate: new Date(filters.endDate),
        });
      }
    }

    const certificates = await queryBuilder.getMany();
    return this.convertToCSV(certificates);
  }

  private convertToCSV(certificates: Certificate[]): string {
    const headers = [
      'ID',
      'Serial Number',
      'Recipient Name',
      'Recipient Email',
      'Title',
      'Course Name',
      'Issuer Name',
      'Issue Date',
      'Status',
      'Expiry Date',
    ];

    const rows = certificates.map((cert) => [
      cert.id,
      cert.verificationCode || cert.id,
      cert.recipientName,
      cert.recipientEmail,
      cert.title,
      cert.courseName,
      cert.issuerName ??
        (cert.issuer
          ? `${cert.issuer.firstName ?? ''} ${cert.issuer.lastName ?? ''}`.trim() ||
            'Unknown'
          : 'Unknown'),
      cert.issuedAt.toISOString().split('T')[0],
      cert.status,
      cert.expiresAt ? cert.expiresAt.toISOString().split('T')[0] : '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    return csvContent;
  }

  async remove(id: string): Promise<void> {
    const certificate = await this.findOne(id);
    await this.certificateRepository.remove(certificate);
  }

  async getCertificatesByRecipient(
    email: string,
    page = 1,
    limit = 10,
  ): Promise<Certificate[]> {
    return this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .where('certificate.recipientEmail = :email', { email })
      .orderBy('certificate.issuedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();
  }

  async getCertificatesByIssuer(
    issuerId: string,
    page = 1,
    limit = 10,
  ): Promise<Certificate[]> {
    return this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .where('certificate.issuerId = :issuerId', { issuerId })
      .orderBy('certificate.issuedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();
  }

  async getDuplicateCertificates(): Promise<Certificate[]> {
    return this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .where('certificate.isDuplicate = :isDuplicate', { isDuplicate: true })
      .orderBy('certificate.issuedAt', 'DESC')
      .getMany();
  }

  // Additional methods from main branch
  async search(dto: SearchCertificatesDto): Promise<any> {
    const queryBuilder = this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer');

    if ((dto as any).search) {
      queryBuilder.andWhere(
        '(certificate.title ILIKE :search OR certificate.recipientName ILIKE :search OR certificate.recipientEmail ILIKE :search)',
        { search: `%${(dto as any).search}%` },
      );
    }

    if ((dto as any).status) {
      queryBuilder.andWhere('certificate.status = :status', {
        status: (dto as any).status,
      });
    }

    if ((dto as any).issuerId) {
      queryBuilder.andWhere('certificate.issuerId = :issuerId', {
        issuerId: (dto as any).issuerId,
      });
    }

    if ((dto as any).page && (dto as any).limit) {
      queryBuilder
        .skip(((dto as any).page - 1) * (dto as any).limit)
        .take((dto as any).limit);
    }

    return queryBuilder.orderBy('certificate.issuedAt', 'DESC').getMany();
  }

  async verifyByCode(
    code: string,
    verifiedBy: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<any> {
    return this.verifyCertificate(code);
  }

  async verifyByStellarHash(
    hash: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<Certificate> {
    const certificate = await this.certificateRepository.findOne({
      where: { stellarTransactionHash: hash },
    });
    if (!certificate) {
      throw new NotFoundException(
        'Certificate not found for this Stellar transaction',
      );
    }
    return certificate;
  }

  async getUserCertificates(
    userId: string,
    page = 1,
    limit = 10,
  ): Promise<Certificate[]> {
    return this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .where('certificate.recipientId = :userId', { userId })
      .orderBy('certificate.issuedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();
  }

  async getCertificateQrCode(id: string): Promise<any> {
    const certificate = await this.findOne(id);
    const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/verify/${certificate.verificationCode}`;
    const qrCode = await QRCode.toDataURL(verificationUrl);
    return {
      id: certificate.id,
      verificationCode: certificate.verificationCode,
      qrCode,
      verificationUrl,
    };
  }

  async getStellarTransactionData(id: string): Promise<any> {
    const certificate = await this.findOne(id);
    return {
      stellarTransactionHash: certificate.stellarTransactionHash,
      stellarTransactionId: certificate.stellarTransactionId,
      stellarMemo: certificate.stellarMemo,
      stellarSequenceNumber: certificate.stellarSequenceNumber,
      issuedAt: certificate.issuedAt,
    };
  }

  async getVerificationHistory(id: string): Promise<Verification[]> {
    return this.verificationRepository.find({
      where: { certificate: { id } as any },
      order: { verifiedAt: 'DESC' },
    });
  }

  async exportCertificate(id: string): Promise<any> {
    const certificate = await this.findOne(id);
    return {
      ...certificate,
      issuer: certificate.issuer,
    };
  }

  async issue(
    dto: IssueCertificateDto,
    userId: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<Certificate> {
    // Override issuerId with the authenticated user's ID (users table)
    const dtoWithUserId = { ...dto, issuerId: userId } as CreateCertificateDto;
    return this.create(
      dtoWithUserId,
      (dto as any).duplicateConfig,
      (dto as any).overrideReason,
      ipAddress,
      userAgent,
    );
  }

  async updateWithUser(
    id: string,
    updateCertificateDto: UpdateCertificateDto,
    userId: string,
  ): Promise<Certificate> {
    const certificate = await this.findOne(id);
    Object.assign(certificate, updateCertificateDto);
    return this.certificateRepository.save(certificate);
  }

  async revokeWithUser(
    id: string,
    dto: RevokeCertificateDto,
    userId: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<Certificate> {
    return this.revoke(id, dto.reason);
  }

  private calculateDefaultExpiry(): Date {
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 1); // Default 1 year expiry
    return expiry;
  }

  private generateVerificationCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  private generateCertificateId(): string {
    const year = new Date().getFullYear();
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let suffix = '';
    for (let i = 0; i < 8; i++) {
      suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `CERT-${year}-${suffix}`;
  }
}
