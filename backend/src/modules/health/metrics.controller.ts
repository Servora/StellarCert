import { Controller, Get, Logger, HttpStatus, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { MetricsService } from '../../common/monitoring/metrics.service';

@ApiTags('metrics')
@Controller('metrics')
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(private metricsService: MetricsService) {}

  /**
   * Prometheus metrics endpoint
   * Returns all collected metrics in Prometheus format
   */
  @Get()
  @ApiOperation({
    summary: 'Get Prometheus metrics',
    description: 'Returns application metrics in Prometheus text format',
  })
  @ApiResponse({
    status: 200,
    description: 'Metrics in Prometheus format',
  })
  async getMetrics(@Res() res: Response): Promise<void> {
    try {
      const metrics = await this.metricsService.getMetrics();
      res.set('Content-Type', 'text/plain; version=0.0.4');
      res.status(HttpStatus.OK).send(metrics);
    } catch (error) {
      this.logger.error('Failed to retrieve metrics', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to retrieve metrics',
      });
    }
  }

  /**
   * Health check for metrics endpoint
   */
  @Get('health')
  @ApiOperation({
    summary: 'Check metrics endpoint health',
  })
  @ApiResponse({
    status: 200,
    description: 'Metrics endpoint is healthy',
  })
  async metricsHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: 'Metrics endpoint is healthy',
    };
  }
}
