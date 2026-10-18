import { Injectable } from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';

import { EmailService } from './email.service';
import { SendEmailDto } from './dto/send-email.dto';
import { LoggingService } from '../../common/logging/logging.service';

export const EMAIL_QUEUE_NAME = 'stellar-email-queue';

export enum EmailJobType {
  SEND_EMAIL = 'send-email',
  SEND_CERTIFICATE_ISSUED = 'send-certificate-issued',
  SEND_VERIFICATION = 'send-verification',
  SEND_PASSWORD_RESET = 'send-password-reset',
  SEND_REVOCATION = 'send-revocation',
}

@Processor(EMAIL_QUEUE_NAME)
@Injectable()
export class EmailQueueProcessor {
  constructor(
    private readonly emailService: EmailService,
    private readonly logger: LoggingService,
  ) {}

  @Process(EmailJobType.SEND_EMAIL)
  async processSendEmail(job: Job<SendEmailDto>): Promise<void> {
    await this.processJob(
      job,
      'email',
      () => this.emailService.sendEmail(job.data),
    );
  }

  @Process(EmailJobType.SEND_CERTIFICATE_ISSUED)
  async processCertificateIssued(job: Job): Promise<void> {
    await this.processJob(
      job,
      'certificate issued email',
      () => this.emailService.sendCertificateIssued(job.data),
    );
  }

  @Process(EmailJobType.SEND_VERIFICATION)
  async processVerificationEmail(job: Job): Promise<void> {
    await this.processJob(
      job,
      'verification email',
      () => this.emailService.sendVerificationEmail(job.data),
    );
  }

  @Process(EmailJobType.SEND_PASSWORD_RESET)
  async processPasswordReset(job: Job): Promise<void> {
    await this.processJob(
      job,
      'password reset email',
      () => this.emailService.sendPasswordReset(job.data),
    );
  }

  @Process(EmailJobType.SEND_REVOCATION)
  async processRevocationNotice(job: Job): Promise<void> {
    await this.processJob(
      job,
      'revocation notice',
      () => this.emailService.sendRevocationNotice(job.data),
    );
  }

  /**
   * Common job execution wrapper.
   *
   * Errors are re-thrown so Bull can mark the job as failed and
   * apply the configured retry/backoff policy.
   */
  private async processJob(
    job: Job,
    description: string,
    handler: () => Promise<void>,
  ): Promise<void> {
    this.logger.log(
      `Processing ${description} job ${job.id}`,
    );

    try {
      await handler();

      this.logger.log(
        `${description} job ${job.id} completed successfully`,
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `${description} job ${job.id} failed: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );

      throw error;
    }
  }

  /**
   * Handles jobs that exhausted their configured retry attempts.
   */
  @Process('failed')
  handleFailedJob(job: Job): void {
    this.logger.error(
      `Email job ${job.id} permanently failed after ` +
        `${job.attemptsMade} attempts: ${job.failedReason}`,
    );
  }
}