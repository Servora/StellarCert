import { RedisRateLimitStore } from './redis-rate-limit.store';
import { resolveRedisUrl } from './rate-limit-store.module';

/** In-memory stand-in for the Redis commands the store uses; models INCR + PEXPIRE + PTTL. */
function fakeRedis() {
  const counters = new Map<string, { count: number; expiresAt: number }>();
  let clock = 0;
  return {
    advance: (ms: number) => {
      clock += ms;
    },
    counters,
    eval: jest.fn((_script: string, _n: number, key: string, ttl: string) => {
      let entry = counters.get(key);
      if (!entry || entry.expiresAt <= clock) {
        entry = { count: 0, expiresAt: clock + Number(ttl) };
        counters.set(key, entry);
      }
      entry.count += 1;
      return Promise.resolve([entry.count, entry.expiresAt - clock]);
    }),
    del: jest.fn((key: string) => {
      counters.delete(key);
      return Promise.resolve(1);
    }),
    quit: jest.fn().mockResolvedValue('OK'),
  };
}

describe('RedisRateLimitStore', () => {
  it('counts hits per key inside a window and reports when it resets', async () => {
    const redis = fakeRedis();
    const store = new RedisRateLimitStore(redis as never);

    const first = await store.consume('1.2.3.4', 60_000, 1_000);
    const second = await store.consume('1.2.3.4', 60_000, 1_500);
    const other = await store.consume('5.6.7.8', 60_000, 1_500);

    expect(first.count).toBe(1);
    expect(first.resetTime).toBe(61_000);
    expect(second.count).toBe(2);
    expect(other.count).toBe(1);
  });

  it('is shared: two store instances on one Redis see the same counter', async () => {
    const redis = fakeRedis();
    const podA = new RedisRateLimitStore(redis as never);
    const podB = new RedisRateLimitStore(redis as never);

    await podA.consume('client', 60_000, 0);
    await podB.consume('client', 60_000, 0);
    const third = await podA.consume('client', 60_000, 0);

    expect(third.count).toBe(3);
  });

  it('starts a new window once the old one expires', async () => {
    const redis = fakeRedis();
    const store = new RedisRateLimitStore(redis as never);

    await store.consume('k', 1_000, 0);
    redis.advance(1_001);

    expect((await store.consume('k', 1_000, 1_001)).count).toBe(1);
  });

  it('namespaces keys and deletes them on reset', async () => {
    const redis = fakeRedis();
    const store = new RedisRateLimitStore(redis as never, 'rl:');

    await store.consume('client', 1_000, 0);
    expect(redis.counters.has('rl:client')).toBe(true);

    await store.reset('client');
    expect(redis.counters.has('rl:client')).toBe(false);
  });

  it('degrades to local counters instead of failing when Redis is down', async () => {
    const redis = fakeRedis();
    redis.eval.mockRejectedValue(new Error('ECONNREFUSED'));
    const store = new RedisRateLimitStore(redis as never);

    const first = await store.consume('client', 60_000, 0);
    const second = await store.consume('client', 60_000, 10);

    expect([first.count, second.count]).toEqual([1, 2]);
  });
});

describe('resolveRedisUrl', () => {
  const lookup = (env: Record<string, string>) => (key: string) => env[key];

  it('prefers REDIS_URL', () => {
    expect(
      resolveRedisUrl(
        lookup({ REDIS_URL: 'redis://cache:6379', REDIS_HOST: 'x' }),
      ),
    ).toBe('redis://cache:6379');
  });

  it('builds a URL from REDIS_HOST, port and password', () => {
    expect(
      resolveRedisUrl(
        lookup({
          REDIS_HOST: 'redis',
          REDIS_PORT: '6380',
          REDIS_PASSWORD: 'p@ss',
        }),
      ),
    ).toBe('redis://:p%40ss@redis:6380');
  });

  it('returns undefined when Redis is not configured', () => {
    expect(resolveRedisUrl(lookup({}))).toBeUndefined();
  });
});
