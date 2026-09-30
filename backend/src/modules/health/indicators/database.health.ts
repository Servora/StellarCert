import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { DataSource } from 'typeorm';
import { LoggingService } from '../../../common/logging/logging.service';

@Injectable()
export class DatabaseHealthIndicator extends HealthIndicator {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggingService,
  ) {
    super();
  }

  async isHealthy(): Promise<HealthIndicatorResult> {
    try {
      const isConnected = this.dataSource.isInitialized;

      if (!isConnected) {
        throw new Error('Database is not initialized');
      }

      // Attempt a simple query to verify database connectivity
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.query('SELECT 1');
      await queryRunner.release();

      this.logger.debug('Database health check passed');

      return this.getStatus('database', true, {
        message: 'Database connection is healthy',
      });
    } catch (error) {
      this.logger.error('Database health check failed', error);
      throw new HealthCheckError(
        'Database check failed',
        this.getStatus('database', false, {
          message: error.message || 'Database is unavailable',
        }),
      );
    }
  }
}
