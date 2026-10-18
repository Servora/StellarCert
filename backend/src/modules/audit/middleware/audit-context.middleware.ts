import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID as uuidv4 } from 'crypto';
import { RequestContextService } from '../services';
import { IRequestContext } from '../interfaces';
import { LoggingService } from '../../../common/logging/logging.service';

@Injectable()
export class AuditContextMiddleware implements NestMiddleware {
  constructor(
    private requestContextService: RequestContextService,
    private readonly logger: LoggingService,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const correlationId = req.get('x-correlation-id') || uuidv4();
    const ipAddress = this.getClientIp(req);
    const userAgent = req.get('user-agent') || 'unknown';

    // Extract user info from JWT if available
    const user = (req as any).user;
    const userId = user?.sub || user?.id;
    const userEmail = user?.email;

    const context: IRequestContext = {
      correlationId,
      ipAddress,
      userAgent,
      userId,
      userEmail,
      timestamp: Date.now(),
    };

    // Store context using correlationId
    this.requestContextService.setContext(correlationId, context);

    // Add context to request for use in resolvers
    (req as any).auditContext = context;

    // Set correlation ID in response headers
    res.setHeader('x-correlation-id', correlationId);

    // Clean up context after response
    res.on('finish', () => {
      this.requestContextService.deleteContext(correlationId);
    });

    next();
  }

  private getClientIp(req: Request): string {
    return (
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
      req.socket.remoteAddress ||
      'unknown'
    );
  }
}
