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
import axios from 'axios';

import {
  WebhookSubscription,
  WebhookEvent,
} from './entities/webhook-subscription.entity';
import { WebhookLog } from './entities/webhook-log.entity';
import { CreateWebhookSubscriptionDto } from './dto/create-webhook-subscription.dto';
import { LoggingService } from '../../common/logging/logging.service';
import { validateWebhookUrl } from '../../common/utils/ssrf.utils';
import {
  truncateWebhookResponse,
  webhookSignatureHeader,
} from './webhook-signature.util';

type SanitizedWebhookSubscription = Omit<
  WebhookSubscription,
  'secret' | 'secretHash'
> & { hasSecret: boolean };

type CreatedWebhookSubscription = Omit<WebhookSubscription, 'secretHash'> & {
  hasSecret: boolean;
};

/** Outcome of a synchronous test delivery. */
export interface WebhookTestResult {
  /** True when the endpoint answered with a 2xx status. */
  success: boolean;
  /** HTTP status returned by the endpoint; 0 when it was never contacted. */
  statusCode: number;
  durationMs: number;
  /** Response body (truncated to 2 KiB) or the error message. */
  response?: string;
  /** Why the endpoint was not contacted or did not answer, when applicable. */
  error?: string;
  /** The `WebhookLog` row recording this attempt. */
  logId?: string;
}

const TEST_DELIVERY_TIMEOUT_MS = 5000;

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
    // can store it; subsequent reads never include `secret` or `secretHash`
    // (the latter is an internal integrity-check value, not the HMAC key).
    const { secretHash: _savedHash, ...rest } = saved;
    return {
      ...rest,
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

  // ROTATE SECRET
  async rotateSecret(
    id: string,
    issuerId: string,
  ): Promise<CreatedWebhookSubscription> {
    const subscription = await this.findOneWithSecret(id, issuerId);
    const secret = crypto.randomBytes(32).toString('hex');
    const secretHash = crypto.createHash('sha256').update(secret).digest('hex');

    subscription.secret = secret;
    subscription.secretHash = secretHash;
    const saved = await this.subscriptionRepository.save(subscription);

    // Same one-time-reveal rule as create (#719): the new plaintext secret
    // goes out once here, but `secretHash` - an internal integrity value,
    // not the HMAC key itself - must not leak into the API response either.
    const { secretHash: _savedHash, ...rest } = saved;
    return {
      ...rest,
      secret,
      hasSecret: true,
    };
  }

  // BROADCAST EVENT
  async triggerEvent(event: WebhookEvent, issuerId: string, payload: any) {
    const subs = await this.subscriptionRepository
      .createQueryBuilder('sub')
      .where('sub.issuerId = :issuerId', { issuerId })
      .andWhere('sub.isActive = :isActive', { isActive: true })
      .andWhere(':event = ANY(sub.events)', { event })
      .getMany();

    let queued = 0;
    for (const sub of subs) {
      if (await this.triggerEventForSubscription(sub, event, payload)) {
        queued++;
      }
    }

    this.logger.log(`Queued ${queued}/${subs.length} webhooks for ${event}`);
  }

  /**
   * Queue one delivery. Webhooks are a best-effort side effect of the primary
   * operation (issuing a certificate, a transfer, ...), so a queue outage (e.g.
   * Redis briefly unavailable) is logged and swallowed instead of propagating to
   * the caller and failing the request that triggered the event.
   *
   * @returns true when the delivery was queued, false when it was dropped.
   */
  async triggerEventForSubscription(
    subscription: WebhookSubscription,
    event: WebhookEvent,
    payload: any,
  ): Promise<boolean> {
    const formattedPayload = {
      event,
      timestamp: new Date().toISOString(),
      data: payload,
    };

    try {
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
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to queue ${event} webhook for subscription ${subscription.id}; delivery dropped: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      return false;
    }
  }

  /**
   * Deliver a test event right now and report what the endpoint did, so an
   * issuer can validate a new webhook URL at setup time (status code, and
   * whether their side accepted the signature) instead of discovering problems
   * when real events start firing. Unlike queued deliveries it is a single
   * attempt with a short timeout and never retries; the attempt is recorded in
   * the delivery log like any other.
   */
  async testDeliverySync(
    subscriptionId: string,
    issuerId: string,
  ): Promise<WebhookTestResult> {
    const subscription = await this.findOneWithSecret(subscriptionId, issuerId);
    const event = WebhookEvent.WEBHOOK_TEST;
    const payload = {
      event,
      timestamp: new Date().toISOString(),
      data: { message: 'Test webhook from StellarCert', test: true },
    };
    const started = Date.now();

    const record = async (
      statusCode: number,
      response: string | undefined,
      isSuccess: boolean,
    ): Promise<string | undefined> => {
      try {
        const row = await this.logRepository.save({
          subscriptionId,
          event,
          payload,
          statusCode,
          response,
          duration: Date.now() - started,
          isSuccess,
        });
        return row?.id;
      } catch (error) {
        this.logger.warn(
          `Could not record test delivery for ${subscriptionId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return undefined;
      }
    };

    // The URL was validated when the subscription was created, but DNS can
    // change since: re-check before every outbound request.
    const validation = await validateWebhookUrl(subscription.url);
    if (!validation.valid) {
      const error = `Webhook URL is not safe: ${validation.error}`;
      return {
        success: false,
        statusCode: 0,
        durationMs: Date.now() - started,
        error,
        response: error,
        logId: await record(0, error, false),
      };
    }

    const timestamp = Math.floor(Date.now() / 1000);
    try {
      const res = await axios.post(subscription.url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-StellarCert-Event': event,
          'X-StellarCert-Signature': webhookSignatureHeader(
            subscription.secret,
            payload,
            timestamp,
          ),
          'User-Agent': 'StellarCert-Webhook/1.0',
        },
        timeout: TEST_DELIVERY_TIMEOUT_MS,
        maxRedirects: 0,
      });
      const body =
        typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      const response = truncateWebhookResponse(body);
      return {
        success: true,
        statusCode: res.status,
        durationMs: Date.now() - started,
        response,
        logId: await record(res.status, response, true),
      };
    } catch (err: any) {
      const statusCode: number = err?.response?.status ?? 0;
      const rawBody = err?.response?.data;
      const response = truncateWebhookResponse(
        rawBody === undefined
          ? err?.message
          : typeof rawBody === 'string'
            ? rawBody
            : JSON.stringify(rawBody),
      );
      return {
        success: false,
        statusCode,
        durationMs: Date.now() - started,
        response,
        error: statusCode
          ? `Endpoint responded with HTTP ${statusCode}`
          : (err?.message ?? 'Request failed'),
        logId: await record(statusCode, response, false),
      };
    }
  }

  // LOGS
  async getLogs(
    subscriptionId: string,
    issuerId: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<{
    data: WebhookLog[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
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
