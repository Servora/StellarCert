import { Injectable, Logger as NestLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';

export interface LogContext {
  correlationId?: string;
  userId?: string;
  requestId?: string;
  [key: string]: any;
}

@Injectable()
export class LoggingService {
  private contextMap: Map<string, LogContext> = new Map();
  private readonly logger = new NestLogger(LoggingService.name);

  constructor(private configService: ConfigService) {}

  /**
   * Generate or retrieve correlation ID
   */
  generateCorrelationId(): string {
    return uuidv4();
  }

  /**
   * Create a new context with correlation ID
   */
  createContext(overrides?: Partial<LogContext>): LogContext {
    const context: LogContext = {
      correlationId: this.generateCorrelationId(),
      requestId: uuidv4(),
      ...overrides,
    };
    if (context.correlationId) {
        this.contextMap.set(context.correlationId, context);
    }
    return context;
  }

  /**
   * Get context by correlation ID
   */
  getContext(correlationId: string): LogContext | undefined {
    return this.contextMap.get(correlationId);
  }

  /**
   * Update context
   */
  updateContext(correlationId: string, updates: Partial<LogContext>): void {
    const context = this.getContext(correlationId);
    if (context) {
      Object.assign(context, updates);
    }
  }

  /**
   * Clear context
   */
  clearContext(correlationId: string): void {
    this.contextMap.delete(correlationId);
  }

  /**
   * Log with context
   */
  log(message: string, context?: LogContext): void {
    const logEntry = this.formatLog('LOG', message, context);
    console.log(logEntry);
  }

  /**
   * Log error with context
   */
  error(message: string, error?: Error | any, context?: LogContext): void {
    const logEntry = this.formatLog('ERROR', message, context, error);
    console.error(logEntry);
  }

  /**
   * Log warning with context
   */
  warn(message: string, context?: LogContext): void {
    const logEntry = this.formatLog('WARN', message, context);
    console.warn(logEntry);
  }

  /**
   * Log debug with context
   */
  debug(message: string, context?: LogContext): void {
    if (this.configService.get<string>('NODE_ENV') !== 'production') {
      const logEntry = this.formatLog('DEBUG', message, context);
      console.debug(logEntry);
    }
  }

  /**
   * Format log entry
   */
  private formatLog(
    level: string,
    message: string,
    context?: LogContext,
    error?: Error | any,
  ): string {
    const timestamp = new Date().toISOString();
    const correlationId = context?.correlationId || 'N/A';
    const requestId = context?.requestId || 'N/A';
    const userId = context?.userId || 'N/A';

    const logObject = {
      timestamp,
      level,
      message,
      correlationId,
      requestId,
      userId,
      ...(context && { context }),
      ...(error && {
        error: {
          message: error.message,
          stack: error.stack,
        },
      }),
    };

    return JSON.stringify(logObject);
  }

  /**
   * Get all contexts (for debugging)
   */
  getAllContexts(): Map<string, LogContext> {
    return this.contextMap;
  }

  /**
   * Clear all contexts
   */
  clearAllContexts(): void {
    this.contextMap.clear();
  }
}
