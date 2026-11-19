import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Brackets, Not } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import * as QRCode from 'qrcode';
import { CreateCertificateDto } from './dto/create-certificate.dto';
import { UpdateCertificateDto } from './dto/update-certificate.dto';
import { IssueCertificateDto } from './dto/issue-certificate.dto';
import { RevokeCertificateDto } from './dto/revoke-certificate.dto';
import { SearchCertificatesDto } from './dto/search-certificates.dto';
import {
  Certificate,
  CertificateMetadata,
} from './entities/certificate.entity';
import { PUBLIC_ISSUER_COLUMNS } from './constants/public-issuer-columns';
import { Verification } from './entities/verification.entity';
import { Issuer } from '../issuers/entities/issuer.entity';
import { CertificateStatus } from './constants/certificate-status.enum';
import { User } from '../users/entities/user.entity';
import { DuplicateDetectionService } from './services/duplicate-detection.service';
import { DuplicateDetectionConfig } from './interfaces/duplicate-detection.interface';
import { WebhooksService } from '../webhooks/webhooks.service';
import { WebhookEvent } from '../webhooks/entities/webhook-subscription.entity';
import { MetadataSchemaService } from '../metadata-schema/services/metadata-schema.service';
import { UserRole } from '../users/entities/user.entity';
import { SorobanService } from '../stellar/services/soroban.service';
import { MAX_EXPORT_LIMIT, MAX_PAGE_LIMIT } from './dto/export-filters.dto';
import { ConfigService } from '@nestjs/config';
import { CryptoUtils } from '../../common/utils/crypto.utils';
import { toCsv } from '../../common/utils/csv.utils';
import { buildVerificationUrl } from '../../config/public-url.config';

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
    private readonly configService: ConfigService,
  ) {}

  /**
   * #1247 — reject an expiry date that is not in the future (and, when the
   * issue date is known, not after it). A certificate stored with a past
   * `expiresAt` is created as `active`, immediately verifies as `expired`,
   * and is counted as active in issuer statistics until the expiration job
   * runs — so the check lives in the service as well as the DTO, because
   * `create()` is also called internally (batch issuance, duplicate
   * overrides) without the validation pipe.
   */
  private assertExpiryIsValid(
    expiresAt: Date | string | undefined,
    issueDate?: Date,
  ): void {
    if (!expiresAt) {
      return;
    }
    const expiry =
      expiresAt instanceof Date ? expiresAt : new Date(String(expiresAt));
    if (Number.isNaN(expiry.getTime())) {
      throw new BadRequestException('expiresAt must be a valid date');
    }
    const reference = issueDate ?? new Date();
    if (expiry.getTime() <= reference.getTime()) {
      throw new BadRequestException(
        issueDate
          ? 'expiresAt must be after the issue date'
          : 'expiresAt must be a date in the future',
      );
    }
  }

  async create(
    dto: CreateCertificateDto,
    duplicateConfig?: DuplicateDetectionConfig,
    overrideReason?: string,
    ipAddress = 'unknown',
    userAgent = 'unknown',
  ): Promise<Certificate> {
    this.assertExpiryIsValid(dto.expiresAt);

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
      const certificateId = await this.generateCertificateId();
      const verificationCode =
        dto.verificationCode || (await this.generateVerificationCode());
      const certificate = queryRunner.manager.create(Certificate, {
        ...dto,
        recipientId,
        certificateId,
        expiresAt: dto.expiresAt || this.calculateDefaultExpiry(),
        verificationCode,
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

      // Keep the issuer's counter in step with what was just saved. It runs in the
      // same transaction, so a rolled-back issuance never leaves a stale count.
      if (savedCertificate.issuerId ?? dto.issuerId) {
        await queryRunner.manager.increment(
          Issuer,
          { id: savedCertificate.issuerId ?? dto.issuerId },
          'certificateCount',
          1,
        );
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
      // `skipStellar` on the request, or STELLAR_ANCHORING_ENABLED=false in the
      // environment, keeps issuance entirely off-chain. The DTO has advertised
      // skipStellar for a while but nothing read it, so passing it changed
      // nothing; local and CI setups have no funded issuer key and need a
      // supported way to opt out rather than relying on the address check
      // below happening to be empty.
      const anchoringEnabled =
        this.configService.get<string>('STELLAR_ANCHORING_ENABLED') !== 'false';
      const skipOnChain = dto.skipStellar === true || !anchoringEnabled;

      if (skipOnChain) {
        this.logger.log(
          `Certificate ${savedCertificate.id}: on-chain issuance skipped (${
            dto.skipStellar === true
              ? 'skipStellar requested'
              : 'STELLAR_ANCHORING_ENABLED=false'
          })`,
        );
      } else if (this.sorobanService.isConfigured()) {
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
              stellarTransactionHash: txHash,
            });
            savedCertificate.stellarTransactionHash = txHash;

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
      // Roll back only while the transaction is still open. The on-chain call
      // runs after commitTransaction(), so a chain failure must not attempt to
      // roll back an already-committed transaction - doing so would mask the
      // original error and leave callers with a misleading failure.
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
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

  /**
   * Re-attempts on-chain issuance for a certificate whose database row was
   * committed but whose Soroban call failed (or was skipped), leaving the
   * record without a `stellarTransactionHash`.
   *
   * Idempotent: a certificate that already carries a transaction hash is
   * returned untouched, so issuers can safely retry the endpoint.
   *
   * @throws ServiceUnavailableException when Soroban is not configured
   * @throws BadRequestException when the certificate is missing the Stellar
   *   addresses the contract call needs
   * @throws InternalServerErrorException when the retry still fails on-chain
   */
  async syncChain(id: string): Promise<{
    certificate: Certificate;
    alreadySynced: boolean;
    stellarTransactionHash: string | null;
  }> {
    const certificate = await this.findOne(id);

    if (certificate.stellarTransactionHash) {
      return {
        certificate,
        alreadySynced: true,
        stellarTransactionHash: certificate.stellarTransactionHash,
      };
    }

    if (!this.sorobanService.isConfigured()) {
      throw new ServiceUnavailableException(
        'Soroban is not configured; on-chain issuance cannot be retried',
      );
    }

    const issuerAddress = certificate.issuerStellarAddress ?? '';
    const ownerAddress = certificate.recipientStellarAddress ?? '';
    if (!issuerAddress || !ownerAddress) {
      throw new BadRequestException(
        'Certificate is missing the Stellar addresses required for on-chain issuance',
      );
    }

    const expiresAtUnix = certificate.expiresAt
      ? Math.floor(certificate.expiresAt.getTime() / 1000)
      : undefined;

    const txHash = await this.sorobanService.issueCertificate(
      certificate.id,
      issuerAddress,
      ownerAddress,
      certificate.verificationCode ?? certificate.id,
      expiresAtUnix,
    );

    if (!txHash) {
      throw new InternalServerErrorException(
        `On-chain issuance failed for certificate ${certificate.id}`,
      );
    }

    await this.certificateRepository.update(certificate.id, {
      stellarTransactionHash: txHash,
    });
    certificate.stellarTransactionHash = txHash;

    this.logger.log(
      `Certificate ${certificate.id} re-issued on-chain via sync-chain`,
    );

    return {
      certificate,
      alreadySynced: false,
      stellarTransactionHash: txHash,
    };
  }

  async findAll(
    page = 1,
    limit = 10,
    issuerId?: string,
    status?: string,
  ): Promise<{ certificates: Certificate[]; total: number }> {
    const safePage = Math.max(1, page || 1);
    const safeLimit = Math.min(Math.max(1, limit || 10), MAX_PAGE_LIMIT);
    const queryBuilder = this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoin('certificate.issuer', 'issuer')
      .addSelect(PUBLIC_ISSUER_COLUMNS)
      .orderBy('certificate.issuedAt', 'DESC');

    if (issuerId) {
      queryBuilder.andWhere('certificate.issuerId = :issuerId', { issuerId });
    }

    if (status) {
      queryBuilder.andWhere('certificate.status = :status', { status });
    }

    const total = await queryBuilder.getCount();
    const certificates = await queryBuilder
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit)
      .getMany();

    return { certificates, total };
  }

  async findOne(id: string): Promise<Certificate> {
    const certificate = await this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoin('certificate.issuer', 'issuer')
      .addSelect(PUBLIC_ISSUER_COLUMNS)
      .where('certificate.id = :id', { id })
      .getOne();

    if (!certificate) {
      throw new NotFoundException(`Certificate with ID ${id} not found`);
    }

    return certificate;
  }

  /**
   * Lookup by serial number scoped to the caller's own certificates (#1146).
   * Admins may look up any serial.
   */
  async findBySerialNumber(
    serialNumber: string,
    requesterId: string,
    requesterRole: string,
  ): Promise<Certificate> {
    const certificate = await this.certificateRepository.findOne({
      where: { certificateId: serialNumber },
      relations: ['issuer'],
    });
    if (!certificate) {
      throw new NotFoundException(
        `Certificate with serial "${serialNumber}" not found`,
      );
    }
    const isAdmin = requesterRole === 'admin' || requesterRole === 'ADMIN';
    if (!isAdmin && certificate.issuerId !== requesterId) {
      throw new NotFoundException(
        `Certificate with serial "${serialNumber}" not found`,
      );
    }
    return certificate;
  }

  /**
   * Public lookup by the human-readable serial (`certificateId`, e.g.
   * CERT-2026-AB12CD34) — the identifier the shareable /c/:publicId page and
   * the embeddable badge are keyed by (#1178). Unlike the UUID `:id` route,
   * this identifier is safe to publish: it grants no write capability and
   * the projection built from it omits email and verification code.
   */
  async findByPublicId(publicId: string): Promise<Certificate> {
    const certificate = await this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoin('certificate.issuer', 'issuer')
      .addSelect(PUBLIC_ISSUER_COLUMNS)
      .where('certificate.certificateId = :publicId', { publicId })
      .getOne();

    if (!certificate) {
      throw new NotFoundException(
        `Certificate with public ID ${publicId} not found`,
      );
    }

    return certificate;
  }

  async findByVerificationCode(verificationCode: string): Promise<Certificate> {
    const certificate = await this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoin('certificate.issuer', 'issuer')
      .addSelect(PUBLIC_ISSUER_COLUMNS)
      .where('certificate.verificationCode = :verificationCode', {
        verificationCode,
      })
      // Deliberately NOT filtered to status='active'. Verification has to be
      // able to answer "this certificate was revoked" or "this one is frozen";
      // filtering non-active rows out here made every one of them come back as
      // "Certificate not found", which is both wrong and the opposite of what
      // a revocation check is for. The mapper classifies the status instead.
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
    this.assertCertificateEditable(certificate);

    // #1247 — an update must not shorten expiry below the issue date either.
    this.assertExpiryIsValid(
      updateCertificateDto.expiresAt,
      certificate.issuedAt,
    );

    Object.assign(certificate, updateCertificateDto);

    return this.certificateRepository.save(certificate);
  }

  async revoke(id: string, reason?: string): Promise<Certificate> {
    const certificate = await this.findOne(id);

    if (certificate.status === CertificateStatus.REVOKED) {
      throw new ConflictException('Certificate has already been revoked');
    }

    const revokedAt = new Date();
    const metadata = reason
      ? {
          ...certificate.metadata,
          revocationReason: reason,
          revokedAt,
        }
      : certificate.metadata;

    // Guard the update by the current status as well as the pre-check above.
    // This keeps a concurrent second request from overwriting the first
    // revocation reason or timestamp.
    const updateResult = await this.certificateRepository.update(
      { id, status: Not(CertificateStatus.REVOKED) },
      {
        status: CertificateStatus.REVOKED,
        revocationReason: reason,
        revokedAt,
        // update() types JSON columns as a deep-partial entity; the metadata
        // object is written whole, so the cast only satisfies that signature.
        metadata: metadata as QueryDeepPartialEntity<CertificateMetadata>,
      },
    );

    if (updateResult.affected !== 1) {
      throw new ConflictException('Certificate has already been revoked');
    }

    const savedCertificate = await this.findOne(id);

    // Trigger webhook event
    await this.webhooksService.triggerEvent(
      WebhookEvent.CERTIFICATE_REVOKED,
      savedCertificate.issuerId,
      {
        id: savedCertificate.id,
        status: savedCertificate.status,
        revocationReason: savedCertificate.revocationReason,
        revokedAt: savedCertificate.revokedAt,
      },
    );

    return savedCertificate;
  }

  async freeze(
    id: string,
    reason?: string,
    durationDays?: number,
    userId?: string,
    userRole?: string,
  ): Promise<Certificate> {
    const certificate = await this.findOne(id);
    this.assertCertificateOwnership(certificate, userId, userRole);

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
      WebhookEvent.CERTIFICATE_FROZEN,
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

  async unfreeze(
    id: string,
    reason?: string,
    userId?: string,
    userRole?: string,
  ): Promise<Certificate> {
    const certificate = await this.findOne(id);
    this.assertCertificateOwnership(certificate, userId, userRole);

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
      WebhookEvent.CERTIFICATE_UNFROZEN,
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
    limit: number = MAX_EXPORT_LIMIT,
    currentUserId?: string,
    userRole?: string,
  ): Promise<Certificate[]> {
    const effectiveIssuerId =
      userRole && userRole !== UserRole.ADMIN
        ? currentUserId
        : (issuerId ?? currentUserId);

    const safeLimit = Math.min(
      Math.max(1, limit || MAX_EXPORT_LIMIT),
      MAX_EXPORT_LIMIT,
    );

    const queryBuilder = this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoin('certificate.issuer', 'issuer')
      .addSelect(PUBLIC_ISSUER_COLUMNS)
      .orderBy('certificate.issuedAt', 'DESC')
      .take(safeLimit);

    if (effectiveIssuerId) {
      queryBuilder.andWhere('certificate.issuerId = :issuerId', {
        issuerId: effectiveIssuerId,
      });
    }

    if (status) {
      queryBuilder.andWhere('certificate.status = :status', { status });
    }

    return queryBuilder.getMany();
  }

  async bulkExport(
    certificateIds: string[],
    filters?: any,
    issuerId?: string,
    userRole?: string,
  ): Promise<string> {
    const effectiveIssuerId =
      userRole && userRole !== UserRole.ADMIN
        ? issuerId
        : (issuerId ??
          (userRole === UserRole.ADMIN ? filters?.issuerId : undefined));

    const maxLimit = Math.min(
      Math.max(1, filters?.limit || MAX_EXPORT_LIMIT),
      MAX_EXPORT_LIMIT,
    );

    const queryBuilder = this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoin('certificate.issuer', 'issuer')
      .addSelect(PUBLIC_ISSUER_COLUMNS)
      .orderBy('certificate.issuedAt', 'DESC')
      .take(maxLimit);

    if (effectiveIssuerId) {
      queryBuilder.andWhere('certificate.issuerId = :issuerId', {
        issuerId: effectiveIssuerId,
      });
    }

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
          '(certificate.certificateId ILIKE :search OR certificate.recipientName ILIKE :search OR certificate.recipientEmail ILIKE :search OR certificate.title ILIKE :search)',
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

      if (filters.issuerId && !effectiveIssuerId) {
        queryBuilder.andWhere('certificate.issuerId = :filterIssuerId', {
          filterIssuerId: filters.issuerId,
        });
      }
    }

    const certificates = await queryBuilder.getMany();
    return this.convertToCSV(certificates);
  }

  async exportAllFiltered(
    filters?: any,
    issuerId?: string,
    userRole?: string,
  ): Promise<string> {
    const effectiveIssuerId =
      userRole && userRole !== UserRole.ADMIN
        ? issuerId
        : (issuerId ??
          (userRole === UserRole.ADMIN ? filters?.issuerId : undefined));

    const maxLimit = Math.min(
      Math.max(1, filters?.limit || MAX_EXPORT_LIMIT),
      MAX_EXPORT_LIMIT,
    );

    const queryBuilder = this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoin('certificate.issuer', 'issuer')
      .addSelect(PUBLIC_ISSUER_COLUMNS)
      .orderBy('certificate.issuedAt', 'DESC')
      .take(maxLimit);

    if (effectiveIssuerId) {
      queryBuilder.andWhere('certificate.issuerId = :issuerId', {
        issuerId: effectiveIssuerId,
      });
    }

    // Apply filters
    if (filters) {
      if (filters.search) {
        queryBuilder.andWhere(
          '(certificate.certificateId ILIKE :search OR certificate.recipientName ILIKE :search OR certificate.recipientEmail ILIKE :search OR certificate.title ILIKE :search)',
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

      if (filters.issuerId && !effectiveIssuerId) {
        queryBuilder.andWhere('certificate.issuerId = :filterIssuerId', {
          filterIssuerId: filters.issuerId,
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
      cert.certificateId,
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

    return toCsv(headers, rows);
  }

  async remove(id: string): Promise<void> {
    const certificate = await this.findOne(id);

    // Issue #1111: an anchored certificate has an on-chain counterpart. Deleting
    // the row writes no audit entry, sends no revocation to the contract, and
    // drops the verification history with it - so the API then answers "not
    // found" while the Soroban record still reports the certificate as Active,
    // and the audit trail loses its subject.
    //
    // Refusing is the half of the fix that needs no schema change: it keeps the
    // row and the chain in agreement. The revoke-and-archive alternative needs a
    // soft-delete column and an on-chain revoke call, neither of which exists
    // today.
    if (certificate.stellarTransactionHash) {
      throw new ConflictException(
        `Certificate ${id} is anchored to transaction ${certificate.stellarTransactionHash} ` +
          `and cannot be deleted. Revoke it instead so the database and the chain stay in agreement.`,
      );
    }

    await this.certificateRepository.remove(certificate);
  }

  async getCertificatesByRecipient(
    email: string,
    page = 1,
    limit = 10,
    currentUserId?: string,
    userRole?: string,
  ): Promise<Certificate[]> {
    const queryBuilder = this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoin('certificate.issuer', 'issuer')
      .addSelect(PUBLIC_ISSUER_COLUMNS)
      .where('certificate.recipientEmail = :email', { email })
      .orderBy('certificate.issuedAt', 'DESC');

    if (userRole !== UserRole.ADMIN) {
      queryBuilder.andWhere('certificate.issuerId = :issuerId', {
        issuerId: currentUserId,
      });
    }

    return queryBuilder
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();
  }

  async getCertificatesByIssuer(
    issuerId: string,
    page = 1,
    limit = 10,
    currentUserId?: string,
    userRole?: string,
  ): Promise<Certificate[]> {
    const effectiveIssuerId =
      userRole === UserRole.ADMIN ? issuerId : currentUserId;

    return this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoin('certificate.issuer', 'issuer')
      .addSelect(PUBLIC_ISSUER_COLUMNS)
      .where('certificate.issuerId = :issuerId', {
        issuerId: effectiveIssuerId,
      })
      .orderBy('certificate.issuedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();
  }

  async getDuplicateCertificates(): Promise<Certificate[]> {
    return this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoin('certificate.issuer', 'issuer')
      .addSelect(PUBLIC_ISSUER_COLUMNS)
      .where('certificate.isDuplicate = :isDuplicate', { isDuplicate: true })
      .orderBy('certificate.issuedAt', 'DESC')
      .getMany();
  }

  // Additional methods from main branch
  async search(
    dto: SearchCertificatesDto,
    currentUserId?: string,
    userRole?: string,
  ): Promise<any> {
    const queryBuilder = this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoin('certificate.issuer', 'issuer')
      .addSelect(PUBLIC_ISSUER_COLUMNS);

    const search = (dto as any).search;
    if (search) {
      // Escape LIKE wildcards so user input is matched literally, and use
      // ILIKE for case-insensitive matching (previously case-sensitive LIKE).
      const escaped = String(search).replace(/[\\%_]/g, '\\$&');
      queryBuilder.andWhere(
        new Brackets((qb) => {
          qb.where('certificate.title ILIKE :search', {
            search: `%${escaped}%`,
          })
            .orWhere('certificate.recipientName ILIKE :search', {
              search: `%${escaped}%`,
            })
            .orWhere('certificate.recipientEmail ILIKE :search', {
              search: `%${escaped}%`,
            })
            .orWhere('certificate.certificateId ILIKE :search', {
              search: `%${escaped}%`,
            });
        }),
      );
    }

    if ((dto as any).status) {
      queryBuilder.andWhere('certificate.status = :status', {
        status: (dto as any).status,
      });
    }

    if (userRole === UserRole.ADMIN) {
      if ((dto as any).issuerId) {
        queryBuilder.andWhere('certificate.issuerId = :issuerId', {
          issuerId: (dto as any).issuerId,
        });
      }
    } else {
      // Fail closed: a non-admin caller is always scoped to their own
      // certificates; a missing id matches nothing rather than everything.
      queryBuilder.andWhere('certificate.issuerId = :issuerId', {
        issuerId: currentUserId ?? null,
      });
    }

    if ((dto as any).startDate) {
      queryBuilder.andWhere('certificate.issuedAt >= :startDate', {
        startDate: new Date((dto as any).startDate),
      });
    }

    if ((dto as any).endDate) {
      queryBuilder.andWhere('certificate.issuedAt <= :endDate', {
        endDate: new Date((dto as any).endDate),
      });
    }

    // Always bound the result set: default page/limit keep the query from
    // degenerating into an unbounded getMany() as the table grows.
    const page = Math.max(1, Number((dto as any).page) || 1);
    const limit = Math.min(
      Math.max(1, Number((dto as any).limit) || 10),
      MAX_PAGE_LIMIT,
    );
    queryBuilder.skip((page - 1) * limit).take(limit);

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
      .leftJoin('certificate.issuer', 'issuer')
      .addSelect(PUBLIC_ISSUER_COLUMNS)
      .where('certificate.recipientId = :userId', { userId })
      .orderBy('certificate.issuedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();
  }

  /**
   * Certificates belonging to the calling user: those linked by recipientId,
   * plus those issued to their email address - but only once that address is
   * verified. Registration does not yet require verification, so trusting an
   * unverified email would let anyone sign up with someone else's address and
   * list their certificates. The flag is read from the database because the
   * JWT carries no verification state.
   */
  async findForRecipient(
    recipientId: string,
    page = 1,
    limit = 10,
  ): Promise<Certificate[]> {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(
      Math.max(1, Number(limit) || 10),
      MAX_PAGE_LIMIT,
    );

    const user = await this.userRepository.findOne({
      where: { id: recipientId },
      select: { id: true, email: true, isEmailVerified: true },
    });
    const verifiedEmail = user?.isEmailVerified ? user.email : undefined;

    const qb = this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoin('certificate.issuer', 'issuer')
      .addSelect(PUBLIC_ISSUER_COLUMNS);

    if (verifiedEmail) {
      qb.where(
        '(certificate.recipientId = :recipientId OR LOWER(certificate.recipientEmail) = LOWER(:email))',
        { recipientId, email: verifiedEmail },
      );
    } else {
      qb.where('certificate.recipientId = :recipientId', { recipientId });
    }

    return qb
      .orderBy('certificate.issuedAt', 'DESC')
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit)
      .getMany();
  }

  async getCertificateQrCode(id: string): Promise<any> {
    const certificate = await this.findOne(id);
    const verificationCode = certificate.verificationCode;
    if (!verificationCode) {
      throw new BadRequestException(
        'Certificate has no verification code to build a QR code for',
      );
    }
    const verificationUrl = buildVerificationUrl(verificationCode);
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

  async getVerificationHistory(
    id: string,
    currentUserId?: string,
    userRole?: string,
  ): Promise<Verification[]> {
    const certificate = await this.findOne(id);
    // Admins and auditors may read any certificate's history; an issuer only
    // their own. Not-found rather than forbidden, so ids cannot be probed.
    const canReadAll =
      userRole === UserRole.ADMIN || userRole === UserRole.AUDITOR;
    if (!canReadAll && certificate.issuerId !== currentUserId) {
      throw new NotFoundException(`Certificate with ID ${id} not found`);
    }

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

  /**
   * Assert that the caller is allowed to mutate a certificate.
   *
   * The issuing account may change only its own certificates; administrators
   * may change any certificate for moderation and recovery. Every other
   * caller — including an authenticated issuer holding another issuer's
   * certificate id — is rejected before any state is written.
   *
   * @throws ForbiddenException when the caller is neither the issuer nor an admin
   */
  private assertCertificateOwnership(
    certificate: Certificate,
    userId?: string,
    userRole?: string,
  ): void {
    if (userRole === UserRole.ADMIN) {
      return;
    }
    if (!userId) {
      throw new ForbiddenException(
        'Issuer identity is required to modify this certificate',
      );
    }
    if (certificate.issuerId !== userId) {
      throw new ForbiddenException(
        'You can only modify certificates issued by your own account',
      );
    }
  }

  /**
   * Assert that a certificate's content may still be edited (#1240).
   *
   * A revoked certificate is a closed record: verifiers, the audit trail and
   * any on-chain anchor all refer to what it said when it was revoked. A
   * frozen certificate is suspended, so its content is held steady too; the
   * issuer must unfreeze it before changing anything. Only an active
   * certificate may be edited.
   *
   * @throws ConflictException when the certificate is not active
   */
  private assertCertificateEditable(certificate: Certificate): void {
    if (certificate.status !== CertificateStatus.ACTIVE) {
      throw new ConflictException(
        `Certificate must be active to be edited. Current status: ${certificate.status}`,
      );
    }
  }

  async updateWithUser(
    id: string,
    updateCertificateDto: UpdateCertificateDto,
    userId: string,
    userRole?: string,
  ): Promise<Certificate> {
    const certificate = await this.findOne(id);
    this.assertCertificateOwnership(certificate, userId, userRole);
    this.assertCertificateEditable(certificate);
    // #1247 — same expiry rule as `update`: never before the issue date.
    this.assertExpiryIsValid(
      updateCertificateDto.expiresAt,
      certificate.issuedAt,
    );
    Object.assign(certificate, updateCertificateDto);
    return this.certificateRepository.save(certificate);
  }

  async revokeWithUser(
    id: string,
    dto: RevokeCertificateDto,
    userId: string,
    ipAddress: string,
    userAgent: string,
    userRole?: string,
  ): Promise<Certificate> {
    const certificate = await this.findOne(id);
    this.assertCertificateOwnership(certificate, userId, userRole);
    return this.revoke(id, dto.reason);
  }

  private calculateDefaultExpiry(): Date {
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 1); // Default 1 year expiry
    return expiry;
  }

  private async generateVerificationCode(): Promise<string> {
    const maxRetries = 10;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const code = CryptoUtils.generateAlphanumericCode(8);
      const exists = await this.certificateRepository.findOne({
        where: { verificationCode: code },
        select: ['id'],
      });
      if (!exists) return code;
    }
    throw new ConflictException(
      'Failed to generate a unique verification code after multiple attempts',
    );
  }

  private async generateCertificateId(): Promise<string> {
    const year = new Date().getFullYear();
    const maxRetries = 10;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const suffix = CryptoUtils.generateAlphanumericCode(8);
      const certificateId = `CERT-${year}-${suffix}`;
      const exists = await this.certificateRepository.findOne({
        where: { certificateId },
        select: ['id'],
      });
      if (!exists) return certificateId;
    }
    throw new ConflictException(
      'Failed to generate a unique certificate ID after multiple attempts',
    );
  }
}
