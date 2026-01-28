import { Controller, Get, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './indicators/database.health';
import { StellarHealthIndicator } from './indicators/stellar.health';

import { Public } from '../../common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
@Public()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private health: HealthCheckService,
    private databaseHealth: DatabaseHealthIndicator,
    private stellarHealth: StellarHealthIndicator,
  ) { }

  /**
   * General health check endpoint
   * Returns basic application status
   */
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Get application health status' })
  @ApiResponse({
    status: 200,
    description: 'Application is healthy',
  })
  async check() {
    try {
      return await this.health.check([]);
    } catch (error) {
      this.logger.error('Health check failed', error);
      throw new HttpException(
        {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Application is unhealthy',
          error,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Readiness probe
   * Checks if all critical dependencies are available
   */
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe - checks all critical dependencies' })
  @ApiResponse({
    status: 200,
    description: 'Application is ready to serve traffic',
  })
  @ApiResponse({
    status: 503,
    description: 'Application is not ready',
  })
  async readiness() {
    try {
      return await this.health.check([
        () => this.databaseHealth.isHealthy(),
        () => this.stellarHealth.isHealthy(),
      ]);
    } catch (error) {
      this.logger.error('Readiness check failed', error);
      throw new HttpException(
        {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Application is not ready',
          error,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Liveness probe
   * Checks if the application is running
   */
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe - checks if application is running' })
  @ApiResponse({
    status: 200,
    description: 'Application is alive',
  })
  async liveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: 'Application is alive',
    };
  }

  /**
   * Database health check
   */
  @Get('database')
  @HealthCheck()
  @ApiOperation({ summary: 'Check database connection' })
  @ApiResponse({
    status: 200,
    description: 'Database is healthy',
  })
  @ApiResponse({
    status: 503,
    description: 'Database is unavailable',
  })
  async databaseCheck() {
    try {
      return await this.health.check([
        () => this.databaseHealth.isHealthy(),
      ]);
    } catch (error) {
      this.logger.error('Database health check failed', error);
      throw new HttpException(
        {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Database is unavailable',
          error,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Stellar network health check
   */
  @Get('stellar')
  @HealthCheck()
  @ApiOperation({ summary: 'Check Stellar network connectivity' })
  @ApiResponse({
    status: 200,
    description: 'Stellar network is reachable',
  })
  @ApiResponse({
    status: 503,
    description: 'Stellar network is unavailable',
  })
  async stellarCheck() {
    try {
      return await this.health.check([
        () => this.stellarHealth.isHealthy(),
      ]);
    } catch (error) {
      this.logger.error('Stellar health check failed', error);
      throw new HttpException(
        {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Stellar network is unavailable',
          error,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
