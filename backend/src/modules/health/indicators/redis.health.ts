import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { LoggingService } from '../../../common/logging/logging.service';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(
    @InjectQueue('stellar-email-queue') private readonly emailQueue: Queue,
    private readonly logger: LoggingService,
  ) {
    super();
  }

  async isHealthy(): Promise<HealthIndicatorResult> {
    try {
      const client = this.emailQueue.client;
      await client.ping();

      this.logger.debug('Redis health check passed');

      return this.getStatus('redis', true, {
        message: 'Redis is healthy',
      });
    } catch (error) {
      this.logger.error('Redis health check failed', error);
      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus('redis', false, {
          message: error.message || 'Redis is unavailable',
        }),
      );
    }
  }
}
