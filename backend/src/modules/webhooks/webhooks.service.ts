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

type SanitizedWebhookSubscription = Omit<
  WebhookSubscription,
  'secret' | 'secretHash'
> & { hasSecret: boolean };

type CreatedWebhookSubscription = WebhookSubscription & { hasSecret: boolean };

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

  /**
   * Issue #719 – Strip the raw HMAC secret from API responses.
   * Clients only receive the secret once at creation time.
   */
  private sanitizeSubscription(
    sub: WebhookSubscription,
  ): SanitizedWebhookSubscription {
    const {
      secret: _secret,
      secretHash: _hash,
      ...rest
    } = sub as WebhookSubscription & {
      secret?: string;
      secretHash?: string;
    };
    return {
      ...rest,
      hasSecret: Boolean(_secret || _hash),
    };
  }

  private sanitizeMany(
    subs: WebhookSubscription[],
  ): SanitizedWebhookSubscription[] {
    return subs.map((s) => this.sanitizeSubscription(s));
  }

  // CREATE
  async createSubscription(
    issuerId: string,
    dto: CreateWebhookSubscriptionDto,
  ): Promise<CreatedWebhookSubscription> {
    // SSRF protection: validate URL resolves to a safe destination
    const validation = await validateWebhookUrl(dto.url);
    if (!validation.valid) {
      throw new BadRequestException(
        `Webhook URL is not safe: ${validation.error}`,
      );
    }

    const secret = crypto.randomBytes(32).toString('hex');
    const secretHash = crypto.createHash('sha256').update(secret).digest('hex');

    const subscription = this.subscriptionRepository.create({
      ...dto,
      issuerId,
      secret,
      secretHash,
      isActive: true,
    });

    const saved = await this.subscriptionRepository.save(subscription);

    // Issue #719 – return the plaintext secret ONLY on create so the caller
    // can store it; subsequent reads never include `secret`.
    return {
      ...saved,
      secret, // one-time reveal
      hasSecret: true,
    };
  }

  // LIST
  async findAll(issuerId: string): Promise<SanitizedWebhookSubscription[]> {
    const rows = await this.subscriptionRepository.find({
      where: { issuerId },
      order: { createdAt: 'DESC' },
    });
    return this.sanitizeMany(rows);
  }

  // FIND ONE
  async findOne(
    id: string,
    issuerId: string,
  ): Promise<SanitizedWebhookSubscription> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { id, issuerId },
    });

    if (!subscription) {
      throw new NotFoundException('Webhook subscription not found');
    }

    return this.sanitizeSubscription(subscription);
  }

  /** Internal: load subscription WITH secret for delivery / signing. */
  async findOneWithSecret(
    id: string,
    issuerId: string,
  ): Promise<WebhookSubscription> {
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
    const subscription = await this.findOneWithSecret(id, issuerId);
    await this.subscriptionRepository.remove(subscription);
  }

  // BROADCAST EVENT
  async triggerEvent(event: WebhookEvent, issuerId: string, payload: any) {
    const subs = await this.subscriptionRepository
      .createQueryBuilder('sub')
      .where('sub.issuerId = :issuerId', { issuerId })
      .andWhere('sub.isActive = :isActive', { isActive: true })
      .andWhere(':event = ANY(sub.events)', { event })
      .getMany();

    for (const sub of subs) {
      await this.triggerEventForSubscription(sub, event, payload);
    }

    this.logger.log(`Queued ${subs.length} webhooks for ${event}`);
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
    page: number = 1,
    limit: number = 50,
  ): Promise<{ data: WebhookLog[]; total: number; page: number; limit: number; totalPages: number }> {
    await this.findOne(subscriptionId, issuerId);

    const [data, total] = await this.logRepository.findAndCount({
      where: { subscriptionId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }
}
