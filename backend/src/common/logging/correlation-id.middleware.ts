import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { LoggingService, LogContext } from '../logging/logging.service';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger(CorrelationIdMiddleware.name);

  constructor(private loggingService: LoggingService) { }

  use(req: Request, res: Response, next: NextFunction): void {
    // Check if correlation ID is provided in headers
    let correlationId = req.headers['x-correlation-id'] as string;

    if (!correlationId) {
      correlationId = this.loggingService.generateCorrelationId();
    }

    // Create context for this request
    const context: LogContext = {
      correlationId,
      requestId: req.headers['x-request-id'] as string,
      userId: (req as any).user?.id,
    };

    // Store context on request object for later use
    (req as any).context = context;

    // Add correlation ID to response headers
    res.setHeader('x-correlation-id', correlationId);
    res.setHeader('x-request-id', context.requestId || '');

    // Log request
    this.loggingService.log(
      `${req.method} ${req.path} - Request started`,
      context,
    );

    // Hook into response to log completion
    const originalSend = res.send;
    res.send = (data: any) => {
      this.loggingService.log(
        `${req.method} ${req.path} - Response sent with status ${res.statusCode}`,
        context,
      );
      return originalSend.apply(res, [data]);
    };

    next();
  }
}
