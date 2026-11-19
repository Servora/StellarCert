import { WebhooksService } from './webhooks.service';
import { WebhookEvent } from './entities/webhook-subscription.entity';

describe('WebhooksService delivery is best-effort', () => {
  const queue = { add: jest.fn() };
  const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
  const getMany = jest.fn();
  const qb: Record<string, jest.Mock> = {};
  for (const m of ['where', 'andWhere']) qb[m] = jest.fn(() => qb);
  qb.getMany = getMany;
  const subscriptions = { createQueryBuilder: jest.fn(() => qb) };

  let service: WebhooksService;
  const sub = (id: string) => ({ id }) as never;

  beforeEach(() => {
    jest.resetAllMocks();
    subscriptions.createQueryBuilder.mockImplementation(() => qb);
    qb.where.mockImplementation(() => qb);
    qb.andWhere.mockImplementation(() => qb);
    queue.add.mockResolvedValue({ id: 'job' });
    service = new WebhooksService(
      subscriptions as never,
      {} as never,
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
    queue.add.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:6379'));

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
});
