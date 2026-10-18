import { Test, TestingModule } from '@nestjs/testing';
import { AuditContextMiddleware } from './audit-context.middleware';
import { RequestContextService } from '../services';
import { Request, Response, NextFunction } from 'express';
import { LoggingService } from '../../../common/logging/logging.service';

describe('AuditContextMiddleware', () => {
  let middleware: AuditContextMiddleware;
  let requestContextService: RequestContextService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditContextMiddleware,
        RequestContextService,
        {
          provide: LoggingService,
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
          },
        },
      ],
    }).compile();

    middleware = module.get<AuditContextMiddleware>(AuditContextMiddleware);
    requestContextService = module.get<RequestContextService>(
      RequestContextService,
    );
  });

  afterEach(() => {
    if (
      requestContextService &&
      typeof requestContextService.clearContext === 'function'
    ) {
      requestContextService.clearContext();
    }
  });

  describe('use', () => {
    let mockRequest: Partial<Request>;
    let mockResponse: Partial<Response>;
    let mockNext: NextFunction;
    let listeners: { [key: string]: Array<(...args: any[]) => void> };

    beforeEach(() => {
      listeners = {};

      mockRequest = {
        get: jest.fn((header: string) => {
          if (header === 'user-agent') return 'Mozilla/5.0';
          if (header === 'x-correlation-id') return null;
          return null;
        }) as any,
        socket: {
          remoteAddress: '127.0.0.1',
        } as any,
        headers: {},
      };

      mockResponse = {
        setHeader: jest.fn(),
        on: jest.fn((event: string, callback: (...args: any[]) => void) => {
          if (!listeners[event]) {
            listeners[event] = [];
          }
          listeners[event].push(callback);
          return mockResponse;
        }) as any,
      };

      mockNext = jest.fn();
    });

    it('should set request context with correlation id', () => {
      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      const contextId = (mockResponse.setHeader as jest.Mock).mock.calls.find(
        (call) => call[0] === 'x-correlation-id',
      )?.[1];

      const context = requestContextService.getContext(contextId);
      expect(context).toBeDefined();
      expect(context?.ipAddress).toBe('127.0.0.1');
    });

    it('should extract x-correlation-id from headers', () => {
      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-correlation-id') return 'test-corr-id-123';
        if (header === 'user-agent') return 'Mozilla/5.0';
        return null;
      });

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'x-correlation-id',
        'test-corr-id-123',
      );
    });

    it('should generate correlation id if not provided', () => {
      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      const calls = (mockResponse.setHeader as jest.Mock).mock.calls;
      const correlationIdCall = calls.find(
        (call) => call[0] === 'x-correlation-id',
      );

      expect(correlationIdCall).toBeDefined();
      expect(correlationIdCall[1]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('should extract client ip from x-forwarded-for header', () => {
      // The middleware reads req.headers['x-forwarded-for'] for the client IP
      mockRequest.headers = {
        'x-forwarded-for': '192.168.1.1, 10.0.0.1',
      };
      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'user-agent') return 'Mozilla/5.0';
        return null;
      });

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      const contextId = (mockResponse.setHeader as jest.Mock).mock.calls.find(
        (call) => call[0] === 'x-correlation-id',
      )?.[1];

      const context = requestContextService.getContext(contextId);
      expect(context?.ipAddress).toBe('192.168.1.1');
    });

    it('should extract user info from request if available', () => {
      (mockRequest as any).user = {
        sub: 'user-123',
        email: 'test@example.com',
      };

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      const contextId = (mockResponse.setHeader as jest.Mock).mock.calls.find(
        (call) => call[0] === 'x-correlation-id',
      )?.[1];

      const context = requestContextService.getContext(contextId);
      expect(context?.userId).toBe('user-123');
      expect(context?.userEmail).toBe('test@example.com');
    });

    it('should set user agent in context', () => {
      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'user-agent') return 'Chrome/91.0';
        return null;
      });

      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      const contextId = (mockResponse.setHeader as jest.Mock).mock.calls.find(
        (call) => call[0] === 'x-correlation-id',
      )?.[1];

      const context = requestContextService.getContext(contextId);
      expect(context?.userAgent).toBe('Chrome/91.0');
    });

    it('should add context to request object', () => {
      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect((mockRequest as any).auditContext).toBeDefined();
      expect((mockRequest as any).auditContext.ipAddress).toBe('127.0.0.1');
    });

    it('should call next middleware', () => {
      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockNext).toHaveBeenCalled();
    });

    it('should clean up context on response finish', () => {
      middleware.use(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      const contextId = (mockResponse.setHeader as jest.Mock).mock.calls.find(
        (call) => call[0] === 'x-correlation-id',
      )?.[1];

      expect(requestContextService.getContext(contextId)).toBeDefined();

      if (listeners['finish']) {
        listeners['finish'].forEach((cb) => cb());
      }

      expect(requestContextService.getContext(contextId)).toBeUndefined();
    });
  });
});
