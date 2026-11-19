import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { MetricsService } from '../monitoring/metrics.service';
import { SentryService } from '../monitoring/sentry.service';
import { LoggingService } from '../logging/logging.service';

/**
 * Global interceptor for automatic metric collection and error handling
 * Tracks request duration, errors, and integration with monitoring services
 */
@Injectable()
export class MonitoringInterceptor implements NestInterceptor {
  constructor(
    private metricsService: MetricsService,
    private sentryService: SentryService,
    private loggingService: LoggingService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, path, url } = request;
    const startTime = Date.now();
    const routeContext = request.context;

    return next.handle().pipe(
      tap((response) => {
        const duration = (Date.now() - startTime) / 1000;
        const route = this.metricsService.normalizeRoute(path);
        const statusCode = context.switchToHttp().getResponse().statusCode;

        // Log successful request
        this.loggingService.log(
          `${method} ${path} completed in ${duration.toFixed(3)}s with status ${statusCode}`,
          routeContext,
        );
      }),
      catchError((error) => {
        const duration = (Date.now() - startTime) / 1000;
        const route = this.metricsService.normalizeRoute(path);

        // Log error
        this.loggingService.error(
          `${method} ${path} failed after ${duration.toFixed(3)}s`,
          error,
          {
            ...routeContext,
            statusCode: error.status || 500,
          },
        );

        // Capture to Sentry if it's a 5xx error
        if (error.status >= 500) {
          this.sentryService.captureException(error, {
            url: path,
            method,
            duration,
            ...routeContext,
          });
        }

        return throwError(() => error);
      }),
    );
  }
}
