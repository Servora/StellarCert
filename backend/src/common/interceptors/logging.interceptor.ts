import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { LoggingService, LogContext } from '../logging/logging.service';

interface RequestWithContext extends Request {
  context?: LogContext;
}

/**
 * Logging Interceptor
 * Logs incoming requests and outgoing responses with correlation IDs
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private loggingService: LoggingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const response = context.switchToHttp().getResponse<Response>();
    const { method, url, body, query, params } = request;
    const context_obj = request.context;
    const startTime = Date.now();

    return next.handle().pipe(
      tap(
        () => {
          const duration = Date.now() - startTime;
          const statusCode = response.statusCode;

          this.loggingService.log(
            `${method} ${url} - ${statusCode} (${duration}ms)`,
            {
              method,
              url,
              statusCode,
              duration,
              body: this.sanitizeBody(body as Record<string, unknown>),
              query: query,
              params: params,
              ...context_obj,
            },
          );
        },
        (error: unknown) => {
          const duration = Date.now() - startTime;
          this.loggingService.error(
            `${method} ${url} failed (${duration}ms)`,
            error,
            {
              method,
              url,
              duration,
              body: this.sanitizeBody(body as Record<string, unknown>),
              ...context_obj,
            },
          );
        },
      ),
    );
  }

  /**
   * Sanitize sensitive data from request body for logging
   */
  private sanitizeBody(
    body: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    if (!body) {
      return undefined;
    }

    const sensitiveFields = ['password', 'token', 'secret', 'apiKey'];
    const sanitized = { ...body };

    sensitiveFields.forEach((field) => {
      if (field in sanitized) {
        sanitized[field] = '***';
      }
    });

    return sanitized;
  }
}
