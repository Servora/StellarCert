import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Certificate } from '../entities/certificate.entity';
import { CertificateStatus } from '../constants/certificate-status.enum';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction } from '../../audit/constants/audit-action.enum';
import { AuditResourceType } from '../../audit/constants/audit-resource-type.enum';
import { StellarService } from '../../stellar/services/stellar.service';
import { ConfigService } from '@nestjs/config';
import { LoggingService } from '../../../common/logging/logging.service';

@Injectable()
export class CertificateExpirationJob {
  constructor(
    @InjectRepository(Certificate)
    private readonly certificateRepository: Repository<Certificate>,
    private readonly stellarService: StellarService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
    private readonly logger: LoggingService,
  ) {}

  /**
   * Runs every hour to mark active certificates as expired.
   * Two expiration criteria are checked:
   *  1. Date-based: expiresAt <= now
   *  2. Stellar sequence-based: if stellarSequenceNumber is set and the issuer
   *     account's current sequence number exceeds it, the certificate is expired.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async checkExpiredCertificates(): Promise<void> {
    this.logger.log('Starting certificate expiration check');

    void this.auditService.log({
      action: AuditAction.BACKGROUND_JOB_START,
      resourceType: AuditResourceType.SYSTEM,
      userId: 'system',
      ipAddress: 'system',
      metadata: { job: 'CertificateExpirationJob' },
      status: 'success',
    });

    // ── 1. Date-based expiration ──────────────────────────────────────────────
    const expiredByDate = await this.certificateRepository
      .createQueryBuilder('cert')
      .where('cert.status = :status', { status: CertificateStatus.ACTIVE })
      .andWhere('cert.expiresAt IS NOT NULL')
      .andWhere('cert.expiresAt <= :now', { now: new Date() })
      .getMany();

    let markedExpired = 0;

    for (const certificate of expiredByDate) {
      try {
        certificate.status = CertificateStatus.EXPIRED;
        await this.certificateRepository.save(certificate);

        void this.auditService.log({
          action: AuditAction.CERTIFICATE_EXPIRE,
          resourceType: AuditResourceType.CERTIFICATE,
          resourceId: certificate.id,
          userId: 'system',
          ipAddress: 'system',
          metadata: {
            certificateId: certificate.certificateId,
            expirationDate: certificate.expiresAt,
            reason: 'date_based',
          },
          status: 'success',
        });

        markedExpired++;
        this.logger.log(
          `Certificate ${certificate.certificateId} marked as expired (date-based)`,
        );
      } catch (error: unknown) {
        this.logger.error(
          `Failed to expire certificate ${certificate.certificateId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // ── 2. Stellar sequence-based expiration ──────────────────────────────────
    const issuerPublicKey = this.configService.get<string>(
      'STELLAR_ISSUER_PUBLIC_KEY',
    );

    if (issuerPublicKey) {
      try {
        const accountInfo =
          await this.stellarService.getAccountInfo(issuerPublicKey);
        const currentSequence = BigInt(accountInfo.sequence);

        const candidatesBySequence = await this.certificateRepository
          .createQueryBuilder('cert')
          .where('cert.status = :status', { status: CertificateStatus.ACTIVE })
          .andWhere('cert.stellarSequenceNumber IS NOT NULL')
          .getMany();

        for (const certificate of candidatesBySequence) {
          if (!certificate.stellarSequenceNumber) continue;

          try {
            const certSequence = BigInt(certificate.stellarSequenceNumber);
            if (currentSequence > certSequence) {
              certificate.status = CertificateStatus.EXPIRED;
              await this.certificateRepository.save(certificate);

              void this.auditService.log({
                action: AuditAction.CERTIFICATE_EXPIRE,
                resourceType: AuditResourceType.CERTIFICATE,
                resourceId: certificate.id,
                userId: 'system',
                ipAddress: 'system',
                metadata: {
                  certificateId: certificate.certificateId,
                  stellarSequence: certificate.stellarSequenceNumber,
                  currentSequence: currentSequence.toString(),
                  reason: 'stellar_sequence',
                },
                status: 'success',
              });

              markedExpired++;
              this.logger.log(
                `Certificate ${certificate.certificateId} marked as expired (Stellar sequence)`,
              );
            }
          } catch (error: unknown) {
            this.logger.error(
              `Failed to check sequence expiration for certificate ${certificate.certificateId}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      } catch (error: unknown) {
        this.logger.warn(
          `Could not fetch Stellar account info for sequence check: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.logger.log(
      `Certificate expiration check complete. Marked ${markedExpired} certificates as expired.`,
    );

    void this.auditService.log({
      action: AuditAction.BACKGROUND_JOB_COMPLETE,
      resourceType: AuditResourceType.SYSTEM,
      userId: 'system',
      ipAddress: 'system',
      metadata: { job: 'CertificateExpirationJob', markedExpired },
      status: 'success',
    });
  }
}
