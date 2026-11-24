import { WebhooksService } from './webhooks.service';
import { WebhookEvent } from './entities/webhook-subscription.entity';

describe('WebhooksService delivery is best-effort', () => {
  const queue = { add: jest.fn() };
  const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
  const getMany = jest.fn();
  const qb: Record<string, jest.Mock> = {};
  for (const m of ['where', 'andWhere']) qb[m] = jest.fn(() => qb);
  qb.getMany = getMany;
  const findOne = jest.fn();
  const saveSubscription = jest.fn();
  const subscriptions = {
    createQueryBuilder: jest.fn(() => qb),
    findOne,
    save: saveSubscription,
  };

  const findSubscriptions = jest.fn();
  const findOneLog = jest.fn();
  const logs = { findOne: findOneLog };

  let service: WebhooksService;
  const sub = (id: string) => ({ id }) as never;

  beforeEach(() => {
    jest.resetAllMocks();
    subscriptions.createQueryBuilder.mockImplementation(() => qb);
    qb.where.mockImplementation(() => qb);
    qb.andWhere.mockImplementation(() => qb);
    findOne.mockReset();
    saveSubscription.mockReset();
    findSubscriptions.mockReset();
    findOneLog.mockReset();
    queue.add.mockResolvedValue({ id: 'job' });
    (subscriptions as Record<string, unknown>).find = findSubscriptions;
    service = new WebhooksService(
      subscriptions as never,
      logs as never,
      queue as never,
      logger as never,
    );
  });

  it('queues a delivery and reports success', async () => {
    const queued = await service.triggerEventForSubscription(
      sub('s1'),
      WebhookEvent.WEBHOOK_TEST,
      { a: 1 },
    );

    expect(queued).toBe(true);
    expect(queue.add).toHaveBeenCalledWith(
      'deliver',
      expect.objectContaining({ subscriptionId: 's1' }),
      expect.objectContaining({ attempts: 5 }),
    );
  });

  it('does not throw when the queue (Redis) is unavailable, and logs the drop', async () => {
    queue.add.mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:6379'),
    );

    await expect(
      service.triggerEventForSubscription(
        sub('s1'),
        WebhookEvent.WEBHOOK_TEST,
        {},
      ),
    ).resolves.toBe(false);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('ECONNREFUSED'),
      expect.any(String),
    );
  });

  it('triggerEvent never rejects because of a queue failure and keeps going', async () => {
    getMany.mockResolvedValue([sub('s1'), sub('s2'), sub('s3')]);
    queue.add
      .mockResolvedValueOnce({ id: '1' })
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValueOnce({ id: '3' });

    await expect(
      service.triggerEvent(WebhookEvent.WEBHOOK_TEST, 'issuer-1', {}),
    ).resolves.toBeUndefined();

    expect(queue.add).toHaveBeenCalledTimes(3);
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('Queued 2/3 webhooks'),
    );
  });

  it('rotates a subscription secret in place and preserves its delivery history', async () => {
    const subscription = {
      id: 's1',
      issuerId: 'issuer-1',
      secret: 'old-secret',
      secretHash: 'old-hash',
      logs: [{ id: 'log-1' }],
    };
    findOne.mockResolvedValue(subscription);
    saveSubscription.mockImplementation((saved) => Promise.resolve(saved));

    const result = await service.rotateSecret('s1', 'issuer-1');

    expect(findOne).toHaveBeenCalledWith({
      where: { id: 's1', issuerId: 'issuer-1' },
    });
    expect(saveSubscription).toHaveBeenCalledWith(subscription);
    expect(result).toMatchObject({
      id: 's1',
      issuerId: 'issuer-1',
      logs: [{ id: 'log-1' }],
      hasSecret: true,
    });
    expect(result.secret).not.toBe('old-secret');
    // secretHash is an internal integrity value, not the HMAC key - it must
    // never reach the API response, same as on create (#719).
    expect(result).not.toHaveProperty('secretHash');
  });

  describe('listFailing (#1305)', () => {
    it('returns subscriptions mid-way through consecutive failures or already paused, with their last failure', async () => {
      const failing = {
        id: 'sub-failing',
        url: 'https://example.com/hook',
        isActive: true,
        consecutiveFailures: 2,
      };
      const paused = {
        id: 'sub-paused',
        url: 'https://paused.example.com/hook',
        isActive: false,
        consecutiveFailures: 3,
        pausedAt: new Date('2026-01-01T00:00:00Z'),
        pausedReason: 'Auto-paused after 3 consecutive failed deliveries',
      };
      findSubscriptions.mockResolvedValue([paused, failing]);
      findOneLog
        .mockResolvedValueOnce({
          createdAt: new Date('2026-01-01T00:00:00Z'),
          deadLetterReason: 'All delivery attempts exhausted',
          response: null,
        })
        .mockResolvedValueOnce({
          createdAt: new Date('2026-01-02T00:00:00Z'),
          deadLetterReason: null,
          response: 'ECONNREFUSED',
        });

      const result = await service.listFailing('issuer-1');

      expect(findSubscriptions).toHaveBeenCalledWith({
        where: [
          { issuerId: 'issuer-1', consecutiveFailures: expect.anything() },
          { issuerId: 'issuer-1', isActive: false },
        ],
        order: { consecutiveFailures: 'DESC' },
      });
      expect(result).toEqual([
        expect.objectContaining({
          id: 'sub-paused',
          isActive: false,
          consecutiveFailures: 3,
          lastFailureReason: 'All delivery attempts exhausted',
        }),
        expect.objectContaining({
          id: 'sub-failing',
          isActive: true,
          consecutiveFailures: 2,
          lastFailureReason: 'ECONNREFUSED',
        }),
      ]);
    });

    it('returns an empty list when nothing is failing, without querying logs', async () => {
      findSubscriptions.mockResolvedValue([]);

      const result = await service.listFailing('issuer-1');

      expect(result).toEqual([]);
      expect(findOneLog).not.toHaveBeenCalled();
    });
  });
});
