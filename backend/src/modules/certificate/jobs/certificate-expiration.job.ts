import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Certificate } from '../entities/certificate.entity';
import { CertificateStatus } from '../constants/certificate-status.enum';
import {
  AuditService,
  LogAuditParams,
} from '../../audit/services/audit.service';
import { AuditAction } from '../../audit/constants/audit-action.enum';
import { AuditResourceType } from '../../audit/constants/audit-resource-type.enum';
import { LoggingService } from '../../../common/logging/logging.service';

/**
 * Expires certificates only when their explicit expiresAt timestamp has passed.
 * Stellar account sequence numbers are transaction counters, not certificate
 * expiry markers, and must never be used to infer certificate expiration.
 */
@Injectable()
export class CertificateExpirationJob {
  constructor(
    @InjectRepository(Certificate)
    private readonly certificateRepository: Repository<Certificate>,
    private readonly auditService: AuditService,
    private readonly logger: LoggingService,
  ) {}

  private async writeAuditLog(params: LogAuditParams): Promise<void> {
    try {
      await this.auditService.log(params);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to write audit log for ${params.action}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async checkExpiredCertificates(): Promise<void> {
    this.logger.log('Starting certificate expiration check');
    await this.writeAuditLog({
      action: AuditAction.BACKGROUND_JOB_START,
      resourceType: AuditResourceType.SYSTEM,
      userId: 'system',
      ipAddress: 'system',
      metadata: { job: 'CertificateExpirationJob' },
      status: 'success',
    });

    const cutoff = new Date();
    let markedExpired = 0;
    try {
      // LessThanOrEqual excludes NULL expiresAt values. Restricting the update
      // to ACTIVE also preserves revoked, frozen, pending, and already-expired rows.
      const result = await this.certificateRepository.update(
        {
          status: CertificateStatus.ACTIVE,
          expiresAt: LessThanOrEqual(cutoff),
        },
        { status: CertificateStatus.EXPIRED },
      );
      markedExpired = result.affected ?? 0;

      if (markedExpired > 0) {
        await this.writeAuditLog({
          action: AuditAction.CERTIFICATE_EXPIRE,
          resourceType: AuditResourceType.CERTIFICATE,
          userId: 'system',
          ipAddress: 'system',
          metadata: {
            reason: 'date_based',
            bulk: true,
            count: markedExpired,
            expiredBefore: cutoff.toISOString(),
          },
          status: 'success',
        });
      }
      this.logger.log(
        `Marked ${markedExpired} certificates as expired (date-based, bulk)`,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Bulk date-based expiration failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.logger.log(
      `Certificate expiration check complete. Marked ${markedExpired} certificates as expired.`,
    );
    await this.writeAuditLog({
      action: AuditAction.BACKGROUND_JOB_COMPLETE,
      resourceType: AuditResourceType.SYSTEM,
      userId: 'system',
      ipAddress: 'system',
      metadata: { job: 'CertificateExpirationJob', markedExpired },
      status: 'success',
    });
  }
}
