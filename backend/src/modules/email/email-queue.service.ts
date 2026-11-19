import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { SendCertificateIssuedDto } from './dto/send-certificate-issued.dto';
import { SendVerificationDto } from './dto/send-verification.dto';
import { SendPasswordResetDto } from './dto/send-password-reset.dto';
import { SendRevocationNoticeDto } from './dto/send-revocation-notice.dto';
import { EMAIL_QUEUE_NAME, EmailJobType } from './email-queue.processor';
import { LoggingService } from '../../common/logging/logging.service';

@Injectable()
export class EmailQueueService {
  constructor(
    @InjectQueue(EMAIL_QUEUE_NAME) private emailQueue: Queue,
    private readonly logger: LoggingService,
  ) {}

  async queueCertificateIssued(dto: SendCertificateIssuedDto): Promise<void> {
    try {
      const job = await this.emailQueue.add(
        EmailJobType.SEND_CERTIFICATE_ISSUED,
        dto,
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
      this.logger.log(`Queued certificate issued email job: ${job.id}`);
    } catch (error) {
      this.logger.error(
        `Failed to queue certificate issued email: ${error.message}`,
      );
      throw error;
    }
  }

  async queueVerificationEmail(dto: SendVerificationDto): Promise<void> {
    try {
      const job = await this.emailQueue.add(
        EmailJobType.SEND_VERIFICATION,
        dto,
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
      this.logger.log(`Queued verification email job: ${job.id}`);
    } catch (error) {
      this.logger.error(`Failed to queue verification email: ${error.message}`);
      throw error;
    }
  }

  async queuePasswordReset(dto: SendPasswordResetDto): Promise<void> {
    try {
      const job = await this.emailQueue.add(
        EmailJobType.SEND_PASSWORD_RESET,
        dto,
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
      this.logger.log(`Queued password reset email job: ${job.id}`);
    } catch (error) {
      this.logger.error(
        `Failed to queue password reset email: ${error.message}`,
      );
      throw error;
    }
  }

  async queueRevocationNotice(dto: SendRevocationNoticeDto): Promise<void> {
    try {
      const job = await this.emailQueue.add(EmailJobType.SEND_REVOCATION, dto, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      });
      this.logger.log(`Queued revocation notice email job: ${job.id}`);
    } catch (error) {
      this.logger.error(
        `Failed to queue revocation notice email: ${error.message}`,
      );
      throw error;
    }
  }

  async getQueueStats(): Promise<{
    active: number;
    delayed: number;
    failed: number;
    completed: number;
  }> {
    const active = await this.emailQueue.getActiveCount();
    const delayed = await this.emailQueue.getDelayedCount();
    const failed = await this.emailQueue.getFailedCount();
    const completed = await this.emailQueue.getCompletedCount();

    return { active, delayed, failed, completed };
  }
}
