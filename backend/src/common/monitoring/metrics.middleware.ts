import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { MetricsService } from '../monitoring/metrics.service';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  private readonly logger = new Logger(MetricsMiddleware.name);

  constructor(private metricsService: MetricsService) { }

  use(req: Request, res: Response, next: NextFunction): void {
    const startTime = Date.now();
    const { method, path } = req;

    // Hook into response to capture metrics
    const originalSend = res.send;
    res.send = (data: any) => {
      const duration = (Date.now() - startTime) / 1000; // Convert to seconds
      const status = res.statusCode;
      const route = this.metricsService.normalizeRoute(path);

      // Record metrics
      this.metricsService.recordHttpRequestDuration(method, route, status, duration);

      if (status >= 400) {
        this.metricsService.recordHttpError(method, route, status);
      }

      return originalSend.apply(res, [data]);
    };

    next();
  }
}

// Add helper method to MetricsService to normalize routes
declare global {
  namespace Express {
    interface Application {
      _router?: any;
    }
  }
}
