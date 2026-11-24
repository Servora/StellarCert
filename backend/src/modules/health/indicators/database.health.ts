import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { DataSource } from 'typeorm';
import { LoggingService } from '../../../common/logging/logging.service';

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggingService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('database');
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

      return indicator.up({
        message: 'Database connection is healthy',
      });
    } catch (error) {
      this.logger.error('Database health check failed', error);
      return indicator.down({
        message: error.message || 'Database is unavailable',
      });
    }
  }
}
