import { Injectable, Logger } from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';
import { CertificateService } from '../certificate.service';
import { IssueCertificateDto } from '../dto/issue-certificate.dto';
import { NotificationsGateway } from '../../notifications/notifications.gateway';

export const BULK_CERTIFICATE_QUEUE_NAME = 'bulk-certificate-issuance-queue';

export enum BulkJobType {
  PROCESS_BULK_ISSUANCE = 'process-bulk-issuance',
}

export interface BulkIssuanceJobData {
  issuerId: string;
  rows: Array<{
    dto: IssueCertificateDto;
    overrideReason?: string;
  }>;
}

export interface BulkIssuanceProgressPayload {
  jobId: string | number;
  total: number;
  current: number;
  progress: number;
  successful: number;
  failed: number;
  status: 'processing' | 'completed' | 'failed';
  currentCertificateId?: string;
  error?: string;
}

@Processor(BULK_CERTIFICATE_QUEUE_NAME)
@Injectable()
export class BulkCertificateProcessor {
  private readonly logger = new Logger(BulkCertificateProcessor.name);

  constructor(
    private readonly certificateService: CertificateService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  @Process(BulkJobType.PROCESS_BULK_ISSUANCE)
  async handleBulkIssuance(job: Job<BulkIssuanceJobData>): Promise<void> {
    const { issuerId, rows } = job.data;
    const total = rows.length;
    let successful = 0;
    let failed = 0;

    this.logger.log(`Starting bulk issuance job ${job.id} for issuer ${issuerId} with ${total} certificates`);

    // Emit initial progress
    this.emitProgress(issuerId, {
      jobId: job.id,
      total,
      current: 0,
      progress: 0,
      successful: 0,
      failed: 0,
      status: 'processing',
    });

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const cert = await this.certificateService.issue(
          row.dto,
          issuerId,
          '127.0.0.1',
          'Bulk Issuance Job',
          undefined,
          row.overrideReason,
        );
        successful++;

        await job.progress(Math.round(((i + 1) / total) * 100));

        this.emitProgress(issuerId, {
          jobId: job.id,
          total,
          current: i + 1,
          progress: Math.round(((i + 1) / total) * 100),
          successful,
          failed,
          status: i + 1 === total ? 'completed' : 'processing',
          currentCertificateId: cert.certificateId || cert.id,
        });
      } catch (err) {
        failed++;
        this.logger.error(`Failed to issue row ${i + 1} in job ${job.id}: ${err.message}`, err.stack);

        await job.progress(Math.round(((i + 1) / total) * 100));

        this.emitProgress(issuerId, {
          jobId: job.id,
          total,
          current: i + 1,
          progress: Math.round(((i + 1) / total) * 100),
          successful,
          failed,
          status: i + 1 === total ? 'completed' : 'processing',
          error: err.message,
        });
      }
    }

    this.logger.log(`Completed bulk issuance job ${job.id}: ${successful} succeeded, ${failed} failed`);
  }

  private emitProgress(issuerId: string, payload: BulkIssuanceProgressPayload): void {
    try {
      this.notificationsGateway.server
        ?.to(`user_${issuerId}`)
        ?.emit('bulkIssuanceProgress', payload);
    } catch (e) {
      this.logger.warn(`Failed to emit socket progress for issuer ${issuerId}: ${e.message}`);
    }
  }
}
