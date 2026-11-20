import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { LoggingService } from '../../../common/logging/logging.service';

/**
 * Example: Custom Health Indicator for External Service
 *
 * This example shows how to create health indicators for external services
 * or any custom dependency that needs health checking.
 */
@Injectable()
export class ExternalServiceHealthIndicator {
  constructor(
    private httpService: HttpService,
    private readonly logger: LoggingService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  /**
   * Check external service health
   */
  async isHealthy(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('external_service');
    try {
      const serviceUrl =
        process.env.EXTERNAL_SERVICE_URL || 'http://external-service:3000';

      // Make health check request with timeout
      const response = await firstValueFrom(
        this.httpService.get(`${serviceUrl}/health`).pipe(timeout(5000)),
      );

      if (response.status === 200) {
        this.logger.debug('External service health check passed');

        return indicator.up({
          message: 'External service is healthy',
          url: serviceUrl,
        });
      }

      throw new Error(`Unexpected status code: ${response.status}`);
    } catch (error) {
      this.logger.error('External service health check failed', error);
      return indicator.down({
        message: error.message || 'External service is unavailable',
      });
    }
  }
}

/**
 * Example: Redis/Cache Health Indicator
 */
@Injectable()
export class CacheHealthIndicator {
  constructor(
    private cacheService: any,
    private readonly logger: LoggingService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('cache');
    try {
      // Attempt to ping cache
      await this.cacheService.ping();

      this.logger.debug('Cache health check passed');

      return indicator.up({
        message: 'Cache is healthy',
      });
    } catch (error) {
      this.logger.error('Cache health check failed', error);
      return indicator.down({
        message: error.message || 'Cache is unavailable',
      });
    }
  }
}

/**
 * Example: Message Queue Health Indicator
 */
@Injectable()
export class MessageQueueHealthIndicator {
  constructor(
    private queueService: any,
    private readonly logger: LoggingService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('message_queue');
    try {
      // Check queue connection
      const isConnected = await this.queueService.isConnected();

      if (!isConnected) {
        throw new Error('Message queue is not connected');
      }

      this.logger.debug('Message queue health check passed');

      return indicator.up({
        message: 'Message queue is healthy',
      });
    } catch (error) {
      this.logger.error('Message queue health check failed', error);
      return indicator.down({
        message: error.message || 'Message queue is unavailable',
      });
    }
  }
}

/**
 * Example: Memory/Resource Health Indicator
 */
@Injectable()
export class MemoryHealthIndicator {
  private readonly maxMemoryUsage = 0.9; // 90%

  constructor(
    private readonly logger: LoggingService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  isHealthy(): HealthIndicatorResult {
    const indicator = this.healthIndicatorService.check('memory');
    try {
      const memUsage = process.memoryUsage();
      const heapUsedPercent = memUsage.heapUsed / memUsage.heapTotal;

      if (heapUsedPercent > this.maxMemoryUsage) {
        throw new Error(
          `Memory usage is high: ${(heapUsedPercent * 100).toFixed(2)}%`,
        );
      }

      this.logger.debug('Memory health check passed');

      return indicator.up({
        message: 'Memory usage is healthy',
        heapUsedPercent: `${(heapUsedPercent * 100).toFixed(2)}%`,
        heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
        heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
      });
    } catch (error) {
      this.logger.error('Memory health check failed', error);
      return indicator.down({
        message: error.message || 'Memory usage is too high',
      });
    }
  }
}
