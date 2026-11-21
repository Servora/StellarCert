import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import axios from 'axios';
import { WebhooksProcessor } from './webhooks.processor';
import {
  WebhookEvent,
  WebhookSubscription,
} from './entities/webhook-subscription.entity';
import { WebhookLog } from './entities/webhook-log.entity';
import { LoggingService } from '../../common/logging/logging.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';

jest.mock('axios');
jest.mock('../../common/utils/ssrf.utils', () => ({
  validateWebhookUrl: jest.fn().mockResolvedValue({ valid: true }),
}));

describe('WebhooksProcessor dead-letter and auto-pause', () => {
  let processor: WebhooksProcessor;
  let subRepo: { findOne: jest.Mock; save: jest.Mock };
  let logRepo: { save: jest.Mock };
  let notificationsService: { createNotification: jest.Mock };

  beforeEach(async () => {
    delete process.env.WEBHOOK_MAX_CONSECUTIVE_FAILURES;

    subRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };
    logRepo = {
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };
    notificationsService = {
      createNotification: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksProcessor,
        {
          provide: getRepositoryToken(WebhookSubscription),
          useValue: subRepo,
        },
        {
          provide: getRepositoryToken(WebhookLog),
          useValue: logRepo,
        },
        {
          provide: LoggingService,
          useValue: {
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
        {
          provide: NotificationsService,
          useValue: notificationsService,
        },
      ],
    }).compile();

    processor = module.get<WebhooksProcessor>(WebhooksProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('creates a dead-letter log and auto-pauses subscription after threshold failures', async () => {
    const sub: Partial<WebhookSubscription> = {
      id: 'sub-1',
      issuerId: 'issuer-1',
      issuer: { id: 'issuer-1', userId: 'user-1' } as any,
      url: 'https://example.com/hook',
      secret: 'secret',
      isActive: true,
      consecutiveFailures: 2,
    };
    subRepo.findOne.mockResolvedValue(sub);

    const job: any = {
      id: 'job-1',
      attemptsMade: 5,
      opts: { attempts: 5 },
      data: {
        subscriptionId: 'sub-1',
        event: WebhookEvent.CERTIFICATE_ISSUED,
        payload: { event: WebhookEvent.CERTIFICATE_ISSUED, data: {} },
      },
    };

    await processor.onJobFailed(job, new Error('ECONNREFUSED'));

    expect(logRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub-1',
        isSuccess: false,
        isDeadLetter: true,
        deadLetterReason: 'ECONNREFUSED',
      }),
    );

    expect(sub.consecutiveFailures).toBe(3);
    expect(sub.isActive).toBe(false);
    expect(sub.pausedAt).toBeInstanceOf(Date);
    expect(subRepo.save).toHaveBeenCalledWith(sub);

    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      'user-1',
      NotificationType.ERROR,
      'Webhook Subscription Auto-Paused',
      expect.stringContaining('3 consecutive delivery failures'),
    );
  });

  it('resets consecutiveFailures on a subsequent successful delivery', async () => {
    const sub: Partial<WebhookSubscription> = {
      id: 'sub-2',
      issuerId: 'issuer-2',
      url: 'https://example.com/hook',
      secret: 'secret',
      isActive: true,
      consecutiveFailures: 2,
    };
    subRepo.findOne.mockResolvedValue(sub);
    (axios.post as jest.Mock).mockResolvedValue({ status: 200, data: 'ok' });

    const job: any = {
      id: 'job-2',
      attemptsMade: 0,
      opts: { attempts: 5 },
      data: {
        subscriptionId: 'sub-2',
        event: WebhookEvent.CERTIFICATE_ISSUED,
        payload: { event: WebhookEvent.CERTIFICATE_ISSUED, data: {} },
      },
    };

    await processor.handleDelivery(job);

    expect(sub.consecutiveFailures).toBe(0);
    expect(subRepo.save).toHaveBeenCalledWith(sub);
  });
});
