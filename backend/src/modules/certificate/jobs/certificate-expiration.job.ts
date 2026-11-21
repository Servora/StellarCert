import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Certificate } from '../entities/certificate.entity';
import { CertificateStatus } from '../constants/certificate-status.enum';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction } from '../../audit/constants/audit-action.enum';
import { AuditResourceType } from '../../audit/constants/audit-resource-type.enum';
import { StellarService } from '../../stellar/services/stellar.service';
import { ConfigService } from '@nestjs/config';
import { LoggingService } from '../../../common/logging/logging.service';

/**
 * Rows fetched per page in the Stellar-sequence pass (#1284).
 * Bounds memory use: at most this many certificates are held at once, no
 * matter how many active certificates carry a sequence number. Raise it to
 * trade memory for fewer queries; lower it if rows become large.
 */
const SEQUENCE_BATCH_SIZE = 500;

/**
 * Scheduled job that moves certificates from ACTIVE to EXPIRED.
 *
 * Dependencies:
 *  - certificateRepository: reads/updates certificate rows.
 *  - stellarService: fetches the issuer account's current sequence number.
 *  - auditService: records job start/finish and expirations.
 *  - configService: supplies STELLAR_ISSUER_PUBLIC_KEY (optional).
 *  - logger: application log output.
 */
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
   *
   * #1284 — the date-based pass is a single set-based UPDATE with one bulk
   * audit entry. It used to load every matching row with getMany() and issue
   * one save() per row, which held the whole result set in memory and
   * serialised thousands of round-trips. The sequence-based pass still decides
   * per row (the comparison depends on a value fetched from Stellar), but it
   * now pages through candidates instead of loading them all at once.
   *
   * Failure handling: each pass catches its own errors and logs them, so a
   * failure in one pass does not stop the other or the closing audit entry.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async checkExpiredCertificates(): Promise<void> {
    this.logger.log('Starting certificate expiration check');

    // Audit calls are fire-and-forget (`void`): a slow or failing audit write
    // must not delay or break the job itself.
    void this.auditService.log({
      action: AuditAction.BACKGROUND_JOB_START,
      resourceType: AuditResourceType.SYSTEM,
      userId: 'system',
      ipAddress: 'system',
      metadata: { job: 'CertificateExpirationJob' },
      status: 'success',
    });

    // Running total across both passes, reported in the final log and audit.
    let markedExpired = 0;

    // ── 1. Date-based expiration (single bulk UPDATE) ─────────────────────────
    // `LessThanOrEqual` never matches NULL, so certificates without an expiry
    // date are left alone. The status = ACTIVE condition in the same statement
    // makes this safe against a concurrent revoke/freeze: a row that changed
    // state after the job started is simply not matched.
    //
    // `cutoff` is captured once so the UPDATE and the audit entry agree on
    // exactly which point in time "expired" was measured against.
    const cutoff = new Date();
    try {
      // repository.update() issues one `UPDATE ... WHERE ...` statement; no
      // entities are loaded and no per-row round-trips happen. `affected` is
      // the number of rows changed (it can be undefined on some drivers, hence
      // the `?? 0`).
      const result = await this.certificateRepository.update(
        {
          status: CertificateStatus.ACTIVE,
          expiresAt: LessThanOrEqual(cutoff),
        },
        { status: CertificateStatus.EXPIRED },
      );
      const expiredByDate = result.affected ?? 0;
      markedExpired += expiredByDate;

      // Skip the audit entry on quiet hours so the log is not filled with
      // zero-count records.
      if (expiredByDate > 0) {
        // One audit entry for the whole batch instead of one per certificate.
        // It records how many rows changed and the cutoff used; individual
        // certificate ids are not listed (see the sequence pass for the
        // per-row alternative).
        void this.auditService.log({
          action: AuditAction.CERTIFICATE_EXPIRE,
          resourceType: AuditResourceType.CERTIFICATE,
          userId: 'system',
          ipAddress: 'system',
          metadata: {
            reason: 'date_based',
            bulk: true,
            count: expiredByDate,
            expiredBefore: cutoff.toISOString(),
          },
          status: 'success',
        });
      }

      this.logger.log(
        `Marked ${expiredByDate} certificates as expired (date-based, bulk)`,
      );
    } catch (error: unknown) {
      // A database failure here is logged and the job carries on to the
      // sequence pass; the next hourly run will retry the date-based update.
      this.logger.error(
        `Bulk date-based expiration failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // ── 2. Stellar sequence-based expiration (per row, paged) ─────────────────
    // This pass is optional: without an issuer public key configured there is
    // no account to read a sequence number from, so it is skipped entirely.
    const issuerPublicKey = this.configService.get<string>(
      'STELLAR_ISSUER_PUBLIC_KEY',
    );

    if (issuerPublicKey) {
      try {
        // One network call per run, not per certificate: the issuer's current
        // sequence number is the same for every comparison below.
        const accountInfo =
          await this.stellarService.getAccountInfo(issuerPublicKey);
        // Sequence numbers can exceed Number.MAX_SAFE_INTEGER, so BigInt is
        // used for all comparisons.
        const currentSequence = BigInt(accountInfo.sequence);

        // Keyset pagination on id: stable even though rows are being updated
        // (and so dropping out of the ACTIVE filter) while we iterate.
        // Offset pagination would skip rows here, because each expired row
        // leaves the result set and shifts everything after it up by one.
        // `lastId` is the last id of the previous page; null means first page.
        let lastId: string | null = null;

        // Loop until a page comes back empty or short (see the breaks below).
        for (;;) {
          // Select only the three columns this pass needs instead of the whole
          // entity, which keeps each page small.
          const query = this.certificateRepository
            .createQueryBuilder('cert')
            .select([
              'cert.id',
              'cert.certificateId',
              'cert.stellarSequenceNumber',
            ])
            .where('cert.status = :status', {
              status: CertificateStatus.ACTIVE,
            })
            .andWhere('cert.stellarSequenceNumber IS NOT NULL')
            // Ordering by id is what makes `id > :lastId` a valid page cursor.
            .orderBy('cert.id', 'ASC')
            .take(SEQUENCE_BATCH_SIZE);

          // After the first page, continue strictly after the last id seen.
          if (lastId) {
            query.andWhere('cert.id > :lastId', { lastId });
          }

          const batch = await query.getMany();
          // No more candidates: done.
          if (batch.length === 0) break;
          // Remember where this page ended, even if no row on it expires.
          lastId = batch[batch.length - 1].id;

          for (const certificate of batch) {
            // Defensive: the query already filters NULLs, but an empty string
            // would still pass it and BigInt('') is 0n, which is misleading.
            if (!certificate.stellarSequenceNumber) continue;

            // Per-row try/catch: a malformed sequence value on one certificate
            // (BigInt() throws on non-numeric input) must not abort the rest.
            try {
              const certSequence = BigInt(certificate.stellarSequenceNumber);
              // The certificate expires only once the issuer account has moved
              // past its recorded sequence; equal means not yet expired.
              if (currentSequence <= certSequence) continue;

              // Guarded update instead of save(): only flips a row that is
              // still ACTIVE, so it cannot overwrite a revoke/freeze that
              // landed after the batch was read.
              const updated = await this.certificateRepository.update(
                { id: certificate.id, status: CertificateStatus.ACTIVE },
                { status: CertificateStatus.EXPIRED },
              );
              // 0 rows affected means someone else changed the status first;
              // do not count it or write an audit entry for a change we did
              // not make.
              if (updated.affected !== 1) continue;

              // Unlike the date-based pass, each row gets its own audit entry
              // here, including the sequence values that justified expiring it.
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
            } catch (error: unknown) {
              this.logger.error(
                `Failed to check sequence expiration for certificate ${certificate.certificateId}: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }

          // A page smaller than the batch size is the last one, so skip the
          // extra query that would return nothing.
          if (batch.length < SEQUENCE_BATCH_SIZE) break;
        }
      } catch (error: unknown) {
        // Covers the Stellar lookup and any query failure. Logged as a warning
        // because the date-based pass has already completed and the sequence
        // pass will be retried on the next run.
        this.logger.warn(
          `Could not fetch Stellar account info for sequence check: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.logger.log(
      `Certificate expiration check complete. Marked ${markedExpired} certificates as expired.`,
    );

    // Closing audit entry pairs with BACKGROUND_JOB_START above and carries the
    // combined total from both passes.
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
