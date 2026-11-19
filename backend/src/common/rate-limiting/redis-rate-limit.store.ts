import { Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import {
  InMemoryRateLimitStore,
  RateLimitEntry,
  RateLimitStore,
} from '../guards/ip-rate-limit.guard';

/**
 * Atomic fixed-window counter: INCR the key, start the window with PEXPIRE on
 * the first hit (and repair a key that somehow lost its TTL), then report the
 * remaining TTL. One round trip, so concurrent replicas cannot interleave.
 */
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

/**
 * Redis-backed {@link RateLimitStore}, shared by every replica so a client
 * cannot multiply its limit by spreading requests across pods, and counters
 * survive restarts. If Redis is unreachable the store degrades to a per-process
 * counter instead of failing every request.
 */
export class RedisRateLimitStore implements RateLimitStore, OnModuleDestroy {
  private readonly logger = new Logger(RedisRateLimitStore.name);
  private readonly fallback = new InMemoryRateLimitStore();

  constructor(
    private readonly redis: Pick<Redis, 'eval' | 'del' | 'quit'>,
    private readonly keyPrefix = 'ratelimit:',
  ) {}

  async consume(
    key: string,
    windowMs: number,
    now: number,
  ): Promise<RateLimitEntry> {
    try {
      const [count, ttl] = (await this.redis.eval(
        CONSUME_SCRIPT,
        1,
        this.keyPrefix + key,
        String(windowMs),
      )) as [number, number];
      return { count: Number(count), resetTime: now + Number(ttl) };
    } catch (error) {
      this.logger.warn(
        `Redis rate-limit store unavailable, using local counters: ${(error as Error).message}`,
      );
      return this.fallback.consume(key, windowMs, now);
    }
  }

  async reset(key: string): Promise<void> {
    await this.fallback.reset(key);
    try {
      await this.redis.del(this.keyPrefix + key);
    } catch (error) {
      this.logger.warn(
        `Could not reset ${key} in Redis: ${(error as Error).message}`,
      );
    }
  }

  /** Redis expires keys itself; only the local fallback needs sweeping. */
  async prune(now: number): Promise<void> {
    await this.fallback.prune(now);
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
