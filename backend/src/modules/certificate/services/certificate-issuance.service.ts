import { Injectable, ConflictException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { CreateCertificateDto } from '../dto/create-certificate.dto';
import { Certificate } from '../entities/certificate.entity';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { DuplicateDetectionConfig } from '../interfaces/duplicate-detection.interface';
import { WebhooksService } from '../../webhooks/webhooks.service';
import { WebhookEvent } from '../../webhooks/entities/webhook-subscription.entity';
import { MetadataSchemaService } from '../../metadata-schema/services/metadata-schema.service';
import { CryptoUtils } from '../../../common/utils/crypto.utils';

@Injectable()
export class CertificateIssuanceService {
  private readonly logger = new Logger(CertificateIssuanceService.name);

  constructor(
    @InjectRepository(Certificate)
    private readonly certificateRepository: Repository<Certificate>,
    private readonly duplicateDetectionService: DuplicateDetectionService,
    private readonly webhooksService: WebhooksService,
    private readonly metadataSchemaService: MetadataSchemaService,
    private readonly dataSource: DataSource,
  ) {}

  async issue(
    createCertificateDto: CreateCertificateDto,
    duplicateConfig?: DuplicateDetectionConfig,
    overrideReason?: string,
  ): Promise<Certificate> {
    // Check for duplicates if config is provided
    if (duplicateConfig?.enabled) {
      const duplicateCheck =
        await this.duplicateDetectionService.checkForDuplicates(
          createCertificateDto,
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

    if (
      createCertificateDto.metadataSchemaId &&
      createCertificateDto.metadata
    ) {
      const validationResult = await this.metadataSchemaService.validate(
        createCertificateDto.metadataSchemaId,
        createCertificateDto.metadata,
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
        createCertificateDto.verificationCode ||
        (await this.generateVerificationCode());
      const certificate = queryRunner.manager.create(Certificate, {
        ...createCertificateDto,
        certificateId,
        expiresAt:
          createCertificateDto.expiresAt || this.calculateDefaultExpiry(),
        verificationCode,
        isDuplicate: false,
      });

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
        `Certificate issued: ${savedCertificate.id} for ${createCertificateDto.recipientEmail}`,
      );

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
        `Failed to issue certificate: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      // Release the QueryRunner
      await queryRunner.release();
    }
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
