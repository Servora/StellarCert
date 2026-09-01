import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../services';
import { AuditAction, AuditResourceType } from '../constants';
import { LoggingService } from '../../../common/logging/logging.service';
import { DistributedLockService } from '../../../common/services/distributed-lock.service';

const AUDIT_CLEANUP_LOCK = 'stellar-cert:cron:audit-cleanup';

@Injectable()
export class AuditCleanupJob {
  constructor(
    private auditService: AuditService,
    private configService: ConfigService,
    private readonly logger: LoggingService,
    private readonly distributedLock: DistributedLockService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCron() {
    const lockToken = await this.distributedLock.acquire(AUDIT_CLEANUP_LOCK);
    if (!lockToken) {
      this.logger.log(
        'Skipping audit log cleanup job; another instance owns the lock',
      );
      return;
    }

    try {
      // Retrieves AUDIT_RETENTION_DAYS from environment config
      // Defaults to 90 days if not configured
      const retentionDays =
        this.configService.get<number>('AUDIT_RETENTION_DAYS') ||
        this.configService.get<number>('audit.retentionDays') ||
        90;

      this.logger.log('Starting audit log cleanup job');

      try {
        // Log the cleanup start
        await this.auditService.log({
          action: AuditAction.BACKGROUND_JOB_START,
          resourceType: AuditResourceType.SYSTEM,
          resourceId: 'audit-cleanup',
          metadata: {
            job: 'audit-cleanup',
            retentionDays,
          },
          status: 'success',
          timestamp: Date.now(),
          ipAddress: 'system',
        });

        const deletedCount =
          await this.auditService.cleanupOldLogs(retentionDays);
        this.logger.log(
          `Audit cleanup completed: ${deletedCount} logs removed`,
        );

        // Log the cleanup completion
        await this.auditService.log({
          action: AuditAction.BACKGROUND_JOB_COMPLETE,
          resourceType: AuditResourceType.SYSTEM,
          resourceId: 'audit-cleanup',
          metadata: {
            job: 'audit-cleanup',
            retentionDays,
            deletedCount,
          },
          status: 'success',
          timestamp: Date.now(),
          ipAddress: 'system',
        });
      } catch (error) {
        this.logger.error(
          `Audit cleanup failed: ${error.message}`,
          error.stack,
        );

        try {
          await this.auditService.log({
            action: AuditAction.BACKGROUND_JOB_FAILED,
            resourceType: AuditResourceType.SYSTEM,
            resourceId: 'audit-cleanup',
            metadata: {
              job: 'audit-cleanup',
              error: error.message,
            },
            status: 'error',
            errorMessage: error.message,
            timestamp: Date.now(),
            ipAddress: 'system',
          });
        } catch (logError) {
          this.logger.error(
            `Failed to log cleanup failure: ${logError.message}`,
            logError.stack,
          );
        }
      }
    } finally {
      await this.distributedLock.release(AUDIT_CLEANUP_LOCK, lockToken);
    }
  }
}
