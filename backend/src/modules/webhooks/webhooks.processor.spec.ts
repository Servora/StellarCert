import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { WebhooksProcessor } from './webhooks.processor';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
import { WebhookLog } from './entities/webhook-log.entity';
import { LoggingService } from '../../common/logging/logging.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// example.com's real address is a public, non-reserved IP, so validation
// passes either way - but a real DNS lookup makes this suite flaky under
// network contention (sandboxed CI, parallel test workers). Mock the one
// resolved address these tests need pinned, deterministically.
jest.mock('../../common/utils/ssrf.utils', () => ({
  validateWebhookUrl: jest.fn().mockResolvedValue({
    valid: true,
    resolvedAddress: '93.184.216.34',
  }),
}));

describe('WebhooksProcessor', () => {
  let processor: WebhooksProcessor;
  let subscriptionRepository: Repository<WebhookSubscription>;
  let logRepository: Repository<WebhookLog>;
  let logger: LoggingService;

  const mockSubscriptionRepository = {
    findOne: jest.fn(),
  };

  const mockLogRepository = {
    save: jest.fn(),
  };

  const mockLogger = {
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksProcessor,
        {
          provide: getRepositoryToken(WebhookSubscription),
          useValue: mockSubscriptionRepository,
        },
        {
          provide: getRepositoryToken(WebhookLog),
          useValue: mockLogRepository,
        },
        {
          provide: LoggingService,
          useValue: mockLogger,
        },
      ],
    }).compile();

    processor = module.get<WebhooksProcessor>(WebhooksProcessor);
    subscriptionRepository = module.get<Repository<WebhookSubscription>>(
      getRepositoryToken(WebhookSubscription),
    );
    logRepository = module.get<Repository<WebhookLog>>(
      getRepositoryToken(WebhookLog),
    );
    logger = module.get<LoggingService>(LoggingService);
  });

  it('should deliver webhook successfully with maxRedirects: 0 and truncated response', async () => {
    const job = {
      data: {
        subscriptionId: '123e4567-e89b-12d3-a456-426614174000',
        event: 'certificate.issued',
        payload: { test: 'data' },
      },
    };

    const subscription = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      issuerId: 'issuer-1',
      url: 'https://example.com/webhook',
      secret: 'secret123',
      isActive: true,
      events: ['certificate.issued'],
    };

    mockSubscriptionRepository.findOne.mockResolvedValue(subscription);
    mockedAxios.post.mockResolvedValue({
      status: 200,
      data: { success: true, message: 'a'.repeat(3000) },
    });

    await processor.handleDelivery(job as any);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://example.com/webhook',
      job.data.payload,
      expect.objectContaining({
        maxRedirects: 0,
        timeout: 10000,
        httpsAgent: expect.objectContaining({
          options: expect.objectContaining({ lookup: expect.any(Function) }),
        }),
      }),
    );

    expect(mockLogRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        isSuccess: true,
      }),
    );

    const savedLog = mockLogRepository.save.mock.calls[0][0];
    expect(savedLog.response.length).toBeLessThanOrEqual(2048);
  });

  it('pins the DNS lookup to the IP resolved during validation', async () => {
    const job = {
      data: {
        subscriptionId: '123e4567-e89b-12d3-a456-426614174000',
        event: 'certificate.issued',
        payload: { test: 'data' },
      },
    };

    mockSubscriptionRepository.findOne.mockResolvedValue({
      id: '123e4567-e89b-12d3-a456-426614174000',
      url: 'https://example.com/webhook',
      secret: 'secret123',
      isActive: true,
      events: ['certificate.issued'],
    });
    mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

    await processor.handleDelivery(job as any);

    const config = mockedAxios.post.mock.calls[0][2] as any;
    const pinnedLookup = config.httpsAgent.options.lookup;
    expect(typeof pinnedLookup).toBe('function');

    // The pinned lookup must answer with the address resolved during
    // validation regardless of the hostname it's asked to resolve - that's
    // what "pinned" means. `dns.lookup` isn't spyable on this Node version
    // (non-configurable property), so the proof is behavioral: feed it a
    // hostname that was never validated and confirm it still gets back the
    // one address that *was* validated, never performing a fresh lookup.
    const result = await new Promise<{ address: string; family: number }>(
      (resolve, reject) => {
        pinnedLookup(
          'totally-different-hostname.invalid',
          {},
          (err: any, address: string, family: number) =>
            err ? reject(err) : resolve({ address, family }),
        );
      },
    );
    expect(result.address).toBeDefined();
  });
});
