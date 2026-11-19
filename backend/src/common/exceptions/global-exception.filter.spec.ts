import {
  ArgumentsHost,
  HttpException,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GlobalExceptionFilter } from './global-exception.filter';
import { SentryService } from '../monitoring/sentry.service';
import { LoggingService } from '../logging/logging.service';
import { NotFoundException } from './exceptions';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let configService: jest.Mocked<ConfigService>;
  let sentryService: jest.Mocked<SentryService>;
  let loggingService: jest.Mocked<LoggingService>;
  let mockResponse: any;
  let mockRequest: any;
  let mockArgumentsHost: ArgumentsHost;

  beforeEach(() => {
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'development';
        return undefined;
      }),
    } as any;

    sentryService = {
      captureException: jest.fn(),
    } as any;

    loggingService = {
      generateCorrelationId: jest
        .fn()
        .mockReturnValue('generated-corr-uuid-123'),
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
    } as any;

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockRequest = {
      url: '/audit/statistics',
      method: 'GET',
      headers: {},
      context: undefined,
    };

    mockArgumentsHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as unknown as ArgumentsHost;

    filter = new GlobalExceptionFilter(
      configService,
      sentryService,
      loggingService,
    );
  });

  describe('Non-HttpException (unhandled server/infrastructure errors)', () => {
    it('should never leak raw SQL error messages to client even in non-production environments', () => {
      const sqlError = new Error('column "eventcount" does not exist');
      mockRequest.url = '/audit/statistics';
      mockRequest.method = 'GET';
      mockRequest.headers = { 'x-correlation-id': 'req-audit-999' };

      filter.catch(sqlError, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: 'INTERNAL_SERVER_ERROR',
          message: 'Internal server error',
          correlationId: 'req-audit-999',
          path: '/audit/statistics',
          method: 'GET',
        }),
      );

      // Verify the response json payload does NOT contain the raw SQL string
      const jsonResponse = mockResponse.json.mock.calls[0][0];
      expect(JSON.stringify(jsonResponse)).not.toContain('eventcount');

      // Verify server-side logging receives the full detailed error and correlation ID
      expect(loggingService.error).toHaveBeenCalledWith(
        'GET /audit/statistics - 500',
        sqlError,
        expect.objectContaining({ correlationId: 'req-audit-999' }),
      );
      expect(sentryService.captureException).toHaveBeenCalledWith(
        sqlError,
        expect.objectContaining({
          statusCode: 500,
          url: '/audit/statistics',
          method: 'GET',
          correlationId: 'req-audit-999',
        }),
      );
    });

    it('should never leak foreign key constraint or database schema details to client', () => {
      const fkError = new Error(
        'insert or update on table "webhook_subscriptions" violates foreign key constraint "FK_webhook_subscriptions_issuerId"',
      );
      mockRequest.url = '/webhooks';
      mockRequest.method = 'POST';

      filter.catch(fkError, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      const jsonResponse = mockResponse.json.mock.calls[0][0];
      expect(jsonResponse.message).toBe('Internal server error');
      expect(jsonResponse.errorCode).toBe('INTERNAL_SERVER_ERROR');
      expect(jsonResponse.correlationId).toBe('generated-corr-uuid-123');
      expect(JSON.stringify(jsonResponse)).not.toContain(
        'webhook_subscriptions',
      );
      expect(JSON.stringify(jsonResponse)).not.toContain('foreign key');
    });

    it('should never leak AWS SDK XML deserialization errors to client', () => {
      const awsError = new Error(
        '@aws-sdk XML parse error: unexpected content. Deserialization error in storage bucket',
      );
      mockRequest.url = '/users/profile/picture';
      mockRequest.method = 'POST';

      filter.catch(awsError, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      const jsonResponse = mockResponse.json.mock.calls[0][0];
      expect(jsonResponse.message).toBe('Internal server error');
      expect(JSON.stringify(jsonResponse)).not.toContain('@aws-sdk');
      expect(JSON.stringify(jsonResponse)).not.toContain('Deserialization');
    });

    it('should fallback to generated correlationId when not present in request context or headers', () => {
      const error = new Error('unexpected runtime failure');

      filter.catch(error, mockArgumentsHost);

      expect(loggingService.generateCorrelationId).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'generated-corr-uuid-123',
        }),
      );
    });

    it('should use correlationId from request.context when available', () => {
      mockRequest.context = { correlationId: 'context-corr-id-456' };
      const error = new Error('database connection lost');

      filter.catch(error, mockArgumentsHost);

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'context-corr-id-456',
        }),
      );
    });

    it('should handle non-Error objects (e.g. string throws) safely', () => {
      const rawStringError = 'Uncaught string exception';

      filter.catch(rawStringError, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: 'INTERNAL_SERVER_ERROR',
          message: 'Internal server error',
          correlationId: 'generated-corr-uuid-123',
        }),
      );
      expect(loggingService.error).toHaveBeenCalled();
    });
  });

  describe('HttpException and custom AppException handling', () => {
    it('should handle HttpException and preserve status code with correlationId', () => {
      const httpException = new HttpException(
        'Access Forbidden',
        HttpStatus.FORBIDDEN,
      );
      mockRequest.url = '/certificates/123';
      mockRequest.method = 'GET';
      mockRequest.headers = { 'x-correlation-id': 'corr-auth-123' };

      filter.catch(httpException, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: 'HTTP_ERROR',
          message: 'Access Forbidden',
          correlationId: 'corr-auth-123',
        }),
      );
      expect(loggingService.warn).toHaveBeenCalledWith(
        'GET /certificates/123 - 403',
        expect.objectContaining({ correlationId: 'corr-auth-123' }),
      );
    });

    it('should handle custom AppException (e.g. NotFoundException)', () => {
      const notFoundException = new NotFoundException('Resource not found');
      mockRequest.url = '/certificates/999';
      mockRequest.method = 'GET';

      filter.catch(notFoundException, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: 'NOT_FOUND',
          message: 'Resource not found',
          correlationId: 'generated-corr-uuid-123',
        }),
      );
    });

    it('should handle BadRequestException with validation errors', () => {
      const badRequest = new BadRequestException(['field must be valid email']);
      mockRequest.url = '/auth/register';
      mockRequest.method = 'POST';

      filter.catch(badRequest, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: 'VALIDATION_ERROR',
          correlationId: 'generated-corr-uuid-123',
        }),
      );
    });
  });
});
