import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../services';
import { AuditAction, AuditResourceType } from '../constants';

@Injectable()
export class AuditCleanupJob {
  private readonly logger = new Logger(AuditCleanupJob.name);

  constructor(
    private auditService: AuditService,
    private configService: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCron() {
    const retentionDays = this.configService.get('audit.retentionDays', 90);

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

      const deletedCount = await this.auditService.cleanupOldLogs(retentionDays);
      this.logger.log(`Audit cleanup completed: ${deletedCount} logs removed`);

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
      this.logger.error(`Audit cleanup failed: ${error.message}`, error.stack);

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
  }
}
