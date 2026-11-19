import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { randomUUID } from 'crypto';
import { RATE_LIMIT_QUEUE_NAME } from '../rate-limiting/rate-limit.service';

const LOCK_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class DistributedLockService {
  constructor(
    @InjectQueue(RATE_LIMIT_QUEUE_NAME) private readonly queue: Queue,
  ) {}

  async acquire(key: string): Promise<string | null> {
    const token = randomUUID();
    const result = await this.queue.client.set(
      key,
      token,
      'PX',
      LOCK_TTL_MS,
      'NX',
    );

    return result === 'OK' ? token : null;
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
