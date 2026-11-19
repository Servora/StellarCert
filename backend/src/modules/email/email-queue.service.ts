import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { SendCertificateIssuedDto } from './dto/send-certificate-issued.dto';
import { SendVerificationDto } from './dto/send-verification.dto';
import { SendPasswordResetDto } from './dto/send-password-reset.dto';
import { SendRevocationNoticeDto } from './dto/send-revocation-notice.dto';
import { SendTransferConfirmationDto } from './dto/send-transfer-confirmation.dto';
import { SendTransferCompletedDto } from './dto/send-transfer-completed.dto';
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

  /**
   * The confirmation code is the only way the new owner learns it, so this job
   * gets more attempts than other emails. Failed jobs are not kept
   * (`removeOnFail: true`): a failed job would otherwise leave the one-time code
   * sitting in Redis. A permanent failure is still logged by the processor.
   */
  async queueTransferConfirmationCode(
    dto: SendTransferConfirmationDto,
  ): Promise<void> {
    try {
      const job = await this.emailQueue.add(
        EmailJobType.SEND_TRANSFER_CONFIRMATION,
        dto,
        {
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      this.logger.log(`Queued transfer confirmation email job: ${job.id}`);
    } catch (error) {
      this.logger.error(
        `Failed to queue transfer confirmation email: ${error.message}`,
      );
      throw error;
    }
  }

  async queueTransferCompletedNotice(
    dto: SendTransferCompletedDto,
  ): Promise<void> {
    try {
      const job = await this.emailQueue.add(
        EmailJobType.SEND_TRANSFER_COMPLETED,
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
      this.logger.log(`Queued transfer completed email job: ${job.id}`);
    } catch (error) {
      this.logger.error(
        `Failed to queue transfer completed email: ${error.message}`,
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
