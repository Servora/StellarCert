import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as crypto from 'crypto';

import {
  WebhookSubscription,
  WebhookEvent,
} from './entities/webhook-subscription.entity';
import { WebhookLog } from './entities/webhook-log.entity';
import { CreateWebhookSubscriptionDto } from './dto/create-webhook-subscription.dto';
import { LoggingService } from '../../common/logging/logging.service';
import { validateWebhookUrl } from '../../common/utils/ssrf.utils';

@Injectable()
export class WebhooksService {
  constructor(
    @InjectRepository(WebhookSubscription)
    private readonly subscriptionRepository: Repository<WebhookSubscription>,

    @InjectRepository(WebhookLog)
    private readonly logRepository: Repository<WebhookLog>,

    @InjectQueue('webhooks')
    private readonly webhookQueue: Queue,
    private readonly logger: LoggingService,
  ) {}

  // CREATE
  async createSubscription(
    issuerId: string,
    dto: CreateWebhookSubscriptionDto,
  ): Promise<WebhookSubscription> {
    // SSRF protection: validate URL resolves to a safe destination
    const validation = await validateWebhookUrl(dto.url);
    if (!validation.valid) {
      throw new BadRequestException(
        `Webhook URL is not safe: ${validation.error}`,
      );
    }

    const secret = crypto.randomBytes(32).toString('hex');

    const subscription = this.subscriptionRepository.create({
      ...dto,
      issuerId,
      secret,
      isActive: true,
    });

    return this.subscriptionRepository.save(subscription);
  }

  // LIST
  async findAll(issuerId: string): Promise<WebhookSubscription[]> {
    return this.subscriptionRepository.find({
      where: { issuerId },
      order: { createdAt: 'DESC' },
    });
  }

  // FIND ONE
  async findOne(id: string, issuerId: string): Promise<WebhookSubscription> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { id, issuerId },
    });

    if (!subscription) {
      throw new NotFoundException('Webhook subscription not found');
    }

    return subscription;
  }

  // DELETE
  async remove(id: string, issuerId: string): Promise<void> {
    const subscription = await this.findOne(id, issuerId);
    await this.subscriptionRepository.remove(subscription);
  }

  // BROADCAST EVENT
  async triggerEvent(event: WebhookEvent, issuerId: string, payload: any) {
    const subs = await this.subscriptionRepository.find({
      where: { issuerId, isActive: true },
    });

    const filtered = subs.filter((s) => s.events.includes(event));

    for (const sub of filtered) {
      await this.triggerEventForSubscription(sub, event, payload);
    }

    this.logger.log(`Queued ${filtered.length} webhooks for ${event}`);
  }

  // SINGLE SUB
  async triggerEventForSubscription(
    subscription: WebhookSubscription,
    event: WebhookEvent,
    payload: any,
  ) {
    const formattedPayload = {
      event,
      timestamp: new Date().toISOString(),
      data: payload,
    };

    await this.webhookQueue.add(
      'deliver',
      {
        subscriptionId: subscription.id,
        event,
        payload: formattedPayload,
      },
      {
        attempts: 5,
        backoff: {
          type: 'webhookRetry',
        },
        removeOnComplete: true,
      },
    );
  }

  // LOGS
  async getLogs(
    subscriptionId: string,
    issuerId: string,
  ): Promise<WebhookLog[]> {
    await this.findOne(subscriptionId, issuerId);

    return this.logRepository.find({
      where: { subscriptionId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }
}
