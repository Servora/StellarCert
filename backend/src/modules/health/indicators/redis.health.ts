import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { LoggingService } from '../../../common/logging/logging.service';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @InjectQueue('stellar-email-queue') private readonly emailQueue: Queue,
    private readonly logger: LoggingService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('redis');
    try {
      const client = this.emailQueue.client;
      await client.ping();

      this.logger.debug('Redis health check passed');

      return indicator.up({
        message: 'Redis is healthy',
      });
    } catch (error) {
      this.logger.error('Redis health check failed', error);
      return indicator.down({
        message: error.message || 'Redis is unavailable',
      });
    }
  }
}
