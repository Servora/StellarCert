import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';
import axios from 'axios';
import * as crypto from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { WebhookSubscription } from './entities/webhook-subscription.entity';
import { WebhookLog } from './entities/webhook-log.entity';
import { LoggingService } from '../../common/logging/logging.service';
import { validateWebhookUrl } from '../../common/utils/ssrf.utils';

@Processor('webhooks')
export class WebhooksProcessor {
  constructor(
    @InjectRepository(WebhookSubscription)
    private readonly subscriptionRepository: Repository<WebhookSubscription>,

    @InjectRepository(WebhookLog)
    private readonly logRepository: Repository<WebhookLog>,
    private readonly logger: LoggingService,
  ) {}

  @Process('deliver')
  async handleDelivery(job: Job) {
    const { subscriptionId, event, payload } = job.data;

    const subscription = await this.subscriptionRepository.findOne({
      where: { id: subscriptionId },
    });

    if (!subscription || !subscription.isActive) {
      this.logger.warn(`Invalid subscription ${subscriptionId}`);
      return;
    }

    // Generate timestamp for signature
    const timestamp = Math.floor(Date.now() / 1000);

    // Create HMAC-SHA256 signature using subscription-specific secret
    // Format: t=<timestamp>,v1=<signature>
    // Signature is computed over: <timestamp>.<json_payload>
    const signature = crypto
      .createHmac('sha256', subscription.secret)
      .update(`${timestamp}.${JSON.stringify(payload)}`)
      .digest('hex');

    // SSRF protection: validate the URL before dispatch
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
        isSuccess: false,
      });
      return;
    }

    try {
      const res = await axios.post(subscription.url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-StellarCert-Event': event,
          'X-StellarCert-Signature': `t=${timestamp},v1=${signature}`,
          'User-Agent': 'StellarCert-Webhook/1.0',
        },
        timeout: 10000,
      });

      await this.logRepository.save({
        subscriptionId,
        event,
        payload,
        statusCode: res.status,
        response: JSON.stringify(res.data),
        isSuccess: true,
      });
    } catch (err) {
      await this.logRepository.save({
        subscriptionId,
        event,
        payload,
        statusCode: err?.response?.status || 500,
        response: err.message,
        isSuccess: false,
      });

      this.logger.error(`Webhook failed: ${err.message}`);

      throw err; // triggers retry
    }
  }
}
