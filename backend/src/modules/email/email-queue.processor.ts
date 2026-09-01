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
    private emailService: EmailService,
    private readonly logger: LoggingService,
  ) {}

  @Process(EmailJobType.SEND_EMAIL)
  async processSendEmail(job: Job<SendEmailDto>): Promise<void> {
    try {
      this.logger.log(`Processing email job: ${job.id}`);
      await this.emailService.sendEmail(job.data);
      this.logger.log(`Email job ${job.id} completed successfully`);
    } catch (error) {
      this.logger.error(`Email job ${job.id} failed: ${error.message}`);
      throw error;
    }
  }

  @Process(EmailJobType.SEND_CERTIFICATE_ISSUED)
  async processCertificateIssued(job: Job): Promise<void> {
    try {
      this.logger.log(`Processing certificate issued job: ${job.id}`);
      await this.emailService.sendCertificateIssued(job.data);
      this.logger.log(
        `Certificate issued job ${job.id} completed successfully`,
      );
    } catch (error) {
      this.logger.error(
        `Certificate issued job ${job.id} failed: ${error.message}`,
      );
      throw error;
    }
  }

  @Process(EmailJobType.SEND_VERIFICATION)
  async processVerificationEmail(job: Job): Promise<void> {
    try {
      this.logger.log(`Processing verification email job: ${job.id}`);
      await this.emailService.sendVerificationEmail(job.data);
      this.logger.log(
        `Verification email job ${job.id} completed successfully`,
      );
    } catch (error) {
      this.logger.error(
        `Verification email job ${job.id} failed: ${error.message}`,
      );
      throw error;
    }
  }

  @Process(EmailJobType.SEND_PASSWORD_RESET)
  async processPasswordReset(job: Job): Promise<void> {
    try {
      this.logger.log(`Processing password reset job: ${job.id}`);
      await this.emailService.sendPasswordReset(job.data);
      this.logger.log(`Password reset job ${job.id} completed successfully`);
    } catch (error) {
      this.logger.error(
        `Password reset job ${job.id} failed: ${error.message}`,
      );
      throw error;
    }
  }

  @Process(EmailJobType.SEND_REVOCATION)
  async processRevocationNotice(job: Job): Promise<void> {
    try {
      this.logger.log(`Processing revocation notice job: ${job.id}`);
      await this.emailService.sendRevocationNotice(job.data);
      this.logger.log(`Revocation notice job ${job.id} completed successfully`);
    } catch (error) {
      this.logger.error(
        `Revocation notice job ${job.id} failed: ${error.message}`,
      );
      throw error;
    }
  }

  @Process('failed')
  handleFailedJob(job: Job): void {
    this.logger.error(
      `Job ${job.id} failed after ${job.attemptsMade} attempts: ${job.failedReason}`,
    );
  }
}
