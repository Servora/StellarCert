import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  InMemoryRateLimitStore,
  RATE_LIMIT_STORE,
  RateLimitStore,
} from '../guards/ip-rate-limit.guard';
import { RedisRateLimitStore } from './redis-rate-limit.store';

/** The Redis connection URL, from `REDIS_URL` or assembled from `REDIS_HOST`/`PORT`/`PASSWORD`. */
export function resolveRedisUrl(
  get: (key: string) => string | undefined,
): string | undefined {
  const url = get('REDIS_URL');
  if (url) return url;

  const host = get('REDIS_HOST');
  if (!host) return undefined;

  const password = get('REDIS_PASSWORD');
  const auth = password ? `:${encodeURIComponent(password)}@` : '';
  return `redis://${auth}${host}:${get('REDIS_PORT') || 6379}`;
}

export function createRateLimitStore(config: ConfigService): RateLimitStore {
  const logger = new Logger('RateLimitStore');
  const url = resolveRedisUrl((key) => config.get<string>(key));

  if (!url) {
    if (config.get<string>('NODE_ENV') === 'production') {
      logger.warn(
        'No REDIS_URL/REDIS_HOST configured: rate limits are tracked per process and are not shared between replicas',
      );
    }
    return new InMemoryRateLimitStore();
  }

  const redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: false });
  redis.on('error', (error) =>
    logger.warn(`Redis connection error: ${error.message}`),
  );
  return new RedisRateLimitStore(redis);
}

/**
 * Binds {@link RATE_LIMIT_STORE} for every rate-limit guard: Redis when it is
 * configured, otherwise the single-process fallback.
 */
@Global()
@Module({
  providers: [
    {
      provide: RATE_LIMIT_STORE,
      inject: [ConfigService],
      useFactory: createRateLimitStore,
    },
  ],
  exports: [RATE_LIMIT_STORE],
})
export class RateLimitStoreModule {}
