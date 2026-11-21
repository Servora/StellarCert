import { Process, Processor, OnQueueFailed } from '@nestjs/bull';
import type { Job } from 'bull';
import axios from 'axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Optional } from '@nestjs/common';

import { WebhookSubscription } from './entities/webhook-subscription.entity';
import { WebhookLog } from './entities/webhook-log.entity';
import { LoggingService } from '../../common/logging/logging.service';
import { validateWebhookUrl } from '../../common/utils/ssrf.utils';
import { webhookSignatureHeader } from './webhook-signature.util';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';

export const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;

export function getMaxConsecutiveFailures(): number {
  const raw = process.env.WEBHOOK_MAX_CONSECUTIVE_FAILURES;
  if (!raw) return DEFAULT_MAX_CONSECUTIVE_FAILURES;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_CONSECUTIVE_FAILURES;
}

@Processor('webhooks')
export class WebhooksProcessor {
  constructor(
    @InjectRepository(WebhookSubscription)
    private readonly subscriptionRepository: Repository<WebhookSubscription>,

    @InjectRepository(WebhookLog)
    private readonly logRepository: Repository<WebhookLog>,

    private readonly logger: LoggingService,

    @Optional()
    private readonly notificationsService?: NotificationsService,
  ) {}

  @Process('deliver')
  async handleDelivery(job: Job) {
    const { subscriptionId, event, payload } = job.data;
    const attemptNumber = (job.attemptsMade ?? 0) + 1;

    const subscription = await this.subscriptionRepository.findOne({
      where: { id: subscriptionId },
      relations: ['issuer'],
    });

    if (!subscription || !subscription.isActive) {
      this.logger.warn(`Invalid or inactive subscription ${subscriptionId}`);
      return;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const signatureHeader = webhookSignatureHeader(
      subscription.secret,
      payload,
      timestamp,
    );

    const validation = await validateWebhookUrl(subscription.url);
    if (!validation.valid) {
      this.logger.warn(
        `Webhook blocked by SSRF protection: ${validation.error}`,
      );
      await this.logRepository.save({
        subscriptionId,
        event,
        payload,
        statusCode: 0,
        response: validation.error,
        attempt: attemptNumber,
        isSuccess: false,
      });
      throw new Error(`SSRF blocked: ${validation.error}`);
    }

    const started = Date.now();
    try {
      const res = await axios.post(subscription.url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-StellarCert-Event': event,
          'X-StellarCert-Signature': signatureHeader,
          'User-Agent': 'StellarCert-Webhook/1.0',
        },
        timeout: 10000,
        maxRedirects: 0,
      });

      const responseBody =
        typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      const truncatedResponse =
        responseBody && responseBody.length > 2048
          ? responseBody.substring(0, 2048)
          : responseBody;

      await this.logRepository.save({
        subscriptionId,
        event,
        payload,
        statusCode: res.status,
        response: truncatedResponse,
        duration: Date.now() - started,
        attempt: attemptNumber,
        isSuccess: true,
      });

      if (subscription.consecutiveFailures > 0) {
        subscription.consecutiveFailures = 0;
        await this.subscriptionRepository.save(subscription);
      }
    } catch (err: any) {
      const errResponse = err?.response?.data
        ? typeof err.response.data === 'string'
          ? err.response.data
          : JSON.stringify(err.response.data)
        : err.message;
      const truncatedErrResponse =
        errResponse && errResponse.length > 2048
          ? errResponse.substring(0, 2048)
          : errResponse;

      await this.logRepository.save({
        subscriptionId,
        event,
        payload,
        statusCode: err?.response?.status || 500,
        response: truncatedErrResponse,
        duration: Date.now() - started,
        attempt: attemptNumber,
        isSuccess: false,
      });

      this.logger.error(
        `Webhook delivery failed (attempt ${attemptNumber}) for subscription ${subscriptionId}: ${err.message}`,
      );

      throw err;
    }
  }

  @OnQueueFailed()
  async onJobFailed(job: Job, err: Error) {
    const maxAttempts = job.opts?.attempts ?? 1;
    const isFinalAttempt = (job.attemptsMade ?? 0) >= maxAttempts;
    if (!isFinalAttempt) {
      return;
    }

    const { subscriptionId, event, payload } = job.data || {};
    if (!subscriptionId) {
      return;
    }

    const reason = err?.message || 'All delivery attempts exhausted';

    await this.logRepository.save({
      subscriptionId,
      event,
      payload,
      statusCode: 0,
      response: reason,
      attempt: job.attemptsMade,
      isSuccess: false,
      isDeadLetter: true,
      deadLetterReason: reason,
    });

    this.logger.error(
      `Dead-lettered webhook job ${job.id} for subscription ${subscriptionId} after ${job.attemptsMade} attempts: ${reason}`,
    );

    const subscription = await this.subscriptionRepository.findOne({
      where: { id: subscriptionId },
      relations: ['issuer'],
    });

    if (!subscription) {
      return;
    }

    subscription.consecutiveFailures = (subscription.consecutiveFailures ?? 0) + 1;
    const threshold = getMaxConsecutiveFailures();

    if (subscription.consecutiveFailures >= threshold && subscription.isActive) {
      subscription.isActive = false;
      subscription.pausedAt = new Date();
      subscription.pausedReason = `Auto-paused after ${subscription.consecutiveFailures} consecutive failed deliveries (${reason})`;
      await this.subscriptionRepository.save(subscription);

      this.logger.warn(
        `Auto-paused webhook subscription ${subscription.id} for issuer ${subscription.issuerId} after ${subscription.consecutiveFailures} consecutive failures`,
      );

      const recipientUserId =
        (subscription.issuer as any)?.userId || subscription.issuerId;

      if (this.notificationsService && recipientUserId) {
        try {
          await this.notificationsService.createNotification(
            recipientUserId,
            NotificationType.ERROR,
            'Webhook Subscription Auto-Paused',
            `Your webhook endpoint (${subscription.url}) was automatically paused after ${subscription.consecutiveFailures} consecutive delivery failures. Latest error: ${reason}`,
          );
        } catch (notifyErr: any) {
          this.logger.error(
            `Failed to notify issuer ${subscription.issuerId} about paused webhook ${subscription.id}: ${notifyErr?.message || notifyErr}`,
          );
        }
      }
    } else {
      await this.subscriptionRepository.save(subscription);
    }
  }
}
