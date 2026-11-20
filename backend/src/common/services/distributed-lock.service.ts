import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { randomUUID } from 'crypto';
import { RATE_LIMIT_QUEUE_NAME } from '../rate-limiting/rate-limit.service';

/**
 * Base lock lifetime. It is deliberately short: a holder that crashes frees the
 * lock after at most this long, and a holder that is still working keeps it by
 * renewing it (see {@link DistributedLockService.startHeartbeat}).
 */
export const DEFAULT_LOCK_TTL_MS = 2 * 60 * 1000;

export interface LockHeartbeatOptions {
  /** Lifetime set on every renewal. Defaults to {@link DEFAULT_LOCK_TTL_MS}. */
  ttlMs?: number;
  /** How often to renew. Defaults to a third of the TTL. */
  intervalMs?: number;
  /** Called once if a renewal finds the lock gone or taken over by another holder. */
  onLost?: () => void;
}

@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);

  constructor(
    @InjectQueue(RATE_LIMIT_QUEUE_NAME) private readonly queue: Queue,
  ) {}

  async acquire(
    key: string,
    ttlMs: number = DEFAULT_LOCK_TTL_MS,
  ): Promise<string | null> {
    const token = randomUUID();
    const result = await this.queue.client.set(key, token, 'PX', ttlMs, 'NX');

    return result === 'OK' ? token : null;
  }

  /**
   * Extends the lock's lifetime to `ttlMs` from now, but only while `token`
   * still owns it. Returns false when the lock expired or belongs to someone else.
   */
  async renew(
    key: string,
    token: string,
    ttlMs: number = DEFAULT_LOCK_TTL_MS,
  ): Promise<boolean> {
    const result = await this.queue.client.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('pexpire', KEYS[1], ARGV[2])
      end
      return 0`,
      1,
      key,
      token,
      String(ttlMs),
    );

    return Number(result) === 1;
  }

  /**
   * Keeps a held lock alive while work is in progress by renewing it on an
   * interval. Call the returned function to stop (before {@link release}). If a
   * renewal reports the lock lost, the heartbeat stops itself and calls `onLost`
   * so the caller can abandon the work; a transient Redis error is logged and
   * retried on the next beat, and the lock still expires on its own.
   */
  startHeartbeat(
    key: string,
    token: string,
    options: LockHeartbeatOptions = {},
  ): () => void {
    const ttlMs = options.ttlMs ?? DEFAULT_LOCK_TTL_MS;
    const intervalMs =
      options.intervalMs ?? Math.max(1000, Math.floor(ttlMs / 3));
    let stopped = false;
    let inFlight = false;

    const timer = setInterval(() => {
      if (stopped || inFlight) return;
      inFlight = true;
      this.renew(key, token, ttlMs)
        .then((renewed) => {
          if (renewed || stopped) return;
          stop();
          this.logger.warn(`Lost distributed lock "${key}" while renewing it`);
          options.onLost?.();
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `Could not renew distributed lock "${key}": ${error instanceof Error ? error.message : String(error)}`,
          );
        })
        .finally(() => {
          inFlight = false;
        });
    }, intervalMs);
    // A heartbeat must never keep the process alive on its own.
    timer.unref?.();

    function stop(): void {
      stopped = true;
      clearInterval(timer);
    }
    return stop;
  }

  async release(key: string, token: string): Promise<void> {
    await this.queue.client.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
      end
      return 0`,
      1,
      key,
      token,
    );
  }
}
