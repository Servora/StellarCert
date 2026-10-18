import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { SentryService } from '../monitoring/sentry.service';
import { LoggingService } from '../logging/logging.service';
import { AppException } from './exceptions';

interface ErrorResponse {
  errorCode: string;
  message: string;
  timestamp: string;
  path: string;
  method: string;
  correlationId?: string;
  details?: unknown;
  stack?: string;
}

interface RequestWithContext extends Request {
  context?: {
    correlationId?: string;
  };
}

@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private isProduction: boolean;

  constructor(
    private configService: ConfigService,
    private sentryService: SentryService,
    private loggingService: LoggingService,
  ) {
    this.isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithContext>();
    const context = request.context;

    let statusCode = 500;
    let errorResponse: ErrorResponse = {
      errorCode: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
    };

    if (context?.correlationId) {
      errorResponse.correlationId = context.correlationId;
    }

    // Handle custom AppException
    if (exception instanceof AppException) {
      const appException = exception.getResponse() as Record<string, unknown>;
      statusCode = exception.getStatus();
      errorResponse = {
        ...errorResponse,
        ...(appException as unknown as Partial<ErrorResponse>),
        path: request.url,
        method: request.method,
      };
      if (context?.correlationId) {
        errorResponse.correlationId = context.correlationId;
      }
      // Remove sensitive information in production
      if (this.isProduction) {
        if (errorResponse.errorCode !== 'VALIDATION_ERROR') {
          delete errorResponse.details;
        }
        delete errorResponse.stack;
      }
    }
    // Handle BadRequestException with validation errors
    else if (exception instanceof BadRequestException) {
      statusCode = 400;
      const exceptionResponse = exception.getResponse() as Record<
        string,
        unknown
      >;
      errorResponse = {
        errorCode: 'VALIDATION_ERROR',
        message: (exceptionResponse.message as string) || 'Validation failed',
        timestamp: new Date().toISOString(),
        path: request.url,
        method: request.method,
      };
      // Only include details in non-production environments
      if (!this.isProduction) {
        errorResponse.details = exceptionResponse.message;
      }
      if (context?.correlationId) {
        errorResponse.correlationId = context.correlationId;
      }
    }
    // Handle HttpException
    else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      errorResponse = {
        errorCode: 'HTTP_ERROR',
        message: exception.message,
        timestamp: new Date().toISOString(),
        path: request.url,
        method: request.method,
      };
      if (context?.correlationId) {
        errorResponse.correlationId = context.correlationId;
      }
    }
    // Handle all other exceptions
    else {
      statusCode = 500;
      const message =
        exception instanceof Error ? exception.message : String(exception);
      errorResponse = {
        errorCode: 'INTERNAL_SERVER_ERROR',
        message: this.isProduction ? 'Internal server error' : message,
        timestamp: new Date().toISOString(),
        path: request.url,
        method: request.method,
      };
      if (context?.correlationId) {
        errorResponse.correlationId = context.correlationId;
      }
    }

    // Log error
    const logMessage = `${request.method} ${request.url} - ${statusCode}`;
    const error =
      exception instanceof Error ? exception : new Error(String(exception));

    if (statusCode >= 500) {
      this.loggingService.error(logMessage, error, context);
      this.sentryService.captureException(error, {
        url: request.url,
        method: request.method,
        statusCode,
        ...context,
      });
    } else {
      this.loggingService.warn(logMessage, context);
    }

    response.status(statusCode).json(errorResponse);
  }
}
