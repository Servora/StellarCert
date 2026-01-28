import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/node';

@Injectable()
export class SentryService {
  private readonly logger = new Logger(SentryService.name);
  private initialized: boolean = false;

  constructor(private configService: ConfigService) {
    this.initializeSentry();
  }

  /**
   * Initialize Sentry
   */
  private initializeSentry(): void {
    const sentryDsn = this.configService.get<string>('SENTRY_DSN');
    const environment = this.configService.get<string>('NODE_ENV') || 'development';
    const enableSentry = this.configService.get<boolean>('ENABLE_SENTRY', false);

    if (enableSentry && sentryDsn) {
      Sentry.init({
        dsn: sentryDsn,
        environment,
        integrations: [
          // Sentry v8 http integration usually handled automatically or via different import
          // Removing strict type checking integration for now to fix build
        ],
        tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
        debug: environment !== 'production',
        normalizeDepth: 5,
      });

      this.initialized = true;
      this.logger.log(`Sentry initialized for environment: ${environment}`);
    } else {
      this.logger.debug('Sentry is disabled or DSN is not configured');
    }
  }

  /**
   * Capture exception
   */
  captureException(error: Error, context?: Record<string, any>): void {
    if (this.initialized) {
      Sentry.captureException(error, {
        contexts: { app: context },
      });
    } else {
      this.logger.error('Exception', error, context);
    }
  }

  /**
   * Capture message
   */
  captureMessage(
    message: string,
    level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'info',
  ): void {
    if (this.initialized) {
      Sentry.captureMessage(message, level);
    } else {
      this.logger.log(message);
    }
  }

  /**
   * Add breadcrumb
   */
  addBreadcrumb(
    message: string,
    category?: string,
    level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug',
  ): void {
    if (this.initialized) {
      Sentry.addBreadcrumb({
        message,
        category: category || 'default',
        level: level || 'info',
      });
    }
  }

  /**
   * Set user context
   */
  setUserContext(userId: string, userEmail?: string, username?: string): void {
    if (this.initialized) {
      Sentry.setUser({
        id: userId,
        email: userEmail,
        username,
      });
    }
  }

  /**
   * Clear user context
   */
  clearUserContext(): void {
    if (this.initialized) {
      Sentry.setUser(null);
    }
  }

  /**
   * Get Sentry client
   */
  getClient(): typeof Sentry {
    return Sentry;
  }

  /**
   * Check if Sentry is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}
