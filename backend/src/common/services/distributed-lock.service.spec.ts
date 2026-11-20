import {
  DEFAULT_LOCK_TTL_MS,
  DistributedLockService,
} from './distributed-lock.service';

describe('DistributedLockService', () => {
  const client = { set: jest.fn(), eval: jest.fn() };
  let service: DistributedLockService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    service = new DistributedLockService({ client } as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('acquire', () => {
    it('uses a short default TTL instead of 30 minutes', async () => {
      client.set.mockResolvedValue('OK');

      const token = await service.acquire('lock:a');

      expect(token).toEqual(expect.any(String));
      expect(client.set).toHaveBeenCalledWith(
        'lock:a',
        token,
        'PX',
        DEFAULT_LOCK_TTL_MS,
        'NX',
      );
      expect(DEFAULT_LOCK_TTL_MS).toBeLessThan(30 * 60 * 1000);
    });

    it('accepts a custom TTL and returns null when the lock is taken', async () => {
      client.set.mockResolvedValue(null);

      expect(await service.acquire('lock:a', 5000)).toBeNull();
      expect(client.set).toHaveBeenCalledWith(
        'lock:a',
        expect.any(String),
        'PX',
        5000,
        'NX',
      );
    });
  });

  describe('renew', () => {
    it('extends the TTL only for the owning token', async () => {
      client.eval.mockResolvedValue(1);

      await expect(service.renew('lock:a', 'tok', 9000)).resolves.toBe(true);

      const [script, keys, key, token, ttl] = client.eval.mock.calls[0];
      expect(script).toContain("redis.call('pexpire'");
      expect(script).toContain("redis.call('get', KEYS[1]) == ARGV[1]");
      expect([keys, key, token, ttl]).toEqual([1, 'lock:a', 'tok', '9000']);
    });

    it('returns false when the lock expired or belongs to someone else', async () => {
      client.eval.mockResolvedValue(0);

      await expect(service.renew('lock:a', 'tok')).resolves.toBe(false);
    });
  });

  describe('startHeartbeat', () => {
    it('renews on every interval until stopped', async () => {
      client.eval.mockResolvedValue(1);

      const stop = service.startHeartbeat('lock:a', 'tok', {
        ttlMs: 30_000,
        intervalMs: 10_000,
      });
      await jest.advanceTimersByTimeAsync(10_000);
      await jest.advanceTimersByTimeAsync(10_000);
      expect(client.eval).toHaveBeenCalledTimes(2);
      expect(client.eval.mock.calls[0][4]).toBe('30000');

      stop();
      await jest.advanceTimersByTimeAsync(60_000);
      expect(client.eval).toHaveBeenCalledTimes(2);
    });

    it('defaults to renewing three times per TTL', async () => {
      client.eval.mockResolvedValue(1);

      const stop = service.startHeartbeat('lock:a', 'tok', { ttlMs: 30_000 });
      await jest.advanceTimersByTimeAsync(10_000);
      expect(client.eval).toHaveBeenCalledTimes(1);
      stop();
    });

    it('stops and reports when the lock is lost', async () => {
      client.eval.mockResolvedValue(0);
      const onLost = jest.fn();

      service.startHeartbeat('lock:a', 'tok', {
        ttlMs: 30_000,
        intervalMs: 10_000,
        onLost,
      });
      await jest.advanceTimersByTimeAsync(10_000);
      expect(onLost).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(60_000);
      expect(client.eval).toHaveBeenCalledTimes(1);
      expect(onLost).toHaveBeenCalledTimes(1);
    });

    it('keeps beating after a transient Redis error', async () => {
      client.eval
        .mockRejectedValueOnce(new Error('connection reset'))
        .mockResolvedValue(1);
      const onLost = jest.fn();

      const stop = service.startHeartbeat('lock:a', 'tok', {
        ttlMs: 30_000,
        intervalMs: 10_000,
        onLost,
      });
      await jest.advanceTimersByTimeAsync(10_000);
      await jest.advanceTimersByTimeAsync(10_000);

      expect(client.eval).toHaveBeenCalledTimes(2);
      expect(onLost).not.toHaveBeenCalled();
      stop();
    });
  });

  it('releases only a lock it still owns', async () => {
    client.eval.mockResolvedValue(1);

    await service.release('lock:a', 'tok');

    const [script, , key, token] = client.eval.mock.calls[0];
    expect(script).toContain("redis.call('del'");
    expect([key, token]).toEqual(['lock:a', 'tok']);
  });
});
