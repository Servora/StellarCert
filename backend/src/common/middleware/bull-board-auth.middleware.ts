import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';

const BULL_BOARD_REALM = 'Bull Board';

interface BasicCredentials {
  username: string;
  password: string;
}

/**
 * Guards the Bull Board dashboard mounted at `/admin/queues`.
 *
 * Bull Board is mounted through `@bull-board/nestjs`, which attaches its own
 * Express router. Nest guards/interceptors never run on that mount, so this
 * middleware — passed to `BullBoardModule.forRoot({ middleware })` — is what
 * actually protects the dashboard.
 *
 * Behaviour:
 *  - In production the dashboard is disabled unless `BULL_BOARD_ENABLED=true`.
 *  - When enabled it requires HTTP Basic credentials from
 *    `BULL_BOARD_USERNAME` / `BULL_BOARD_PASSWORD` (never hardcoded).
 *  - Outside production, if no credentials are configured the board stays
 *    reachable so local development keeps working.
 */
@Injectable()
export class BullBoardAuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(BullBoardAuthMiddleware.name);

  constructor(private readonly configService: ConfigService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const nodeEnv = this.readString('NODE_ENV') || 'development';
    const isProduction = nodeEnv.toLowerCase() === 'production';

    const configuredEnabled = this.readBoolean('BULL_BOARD_ENABLED');
    const enabled = configuredEnabled ?? !isProduction;

    if (!enabled) {
      this.logger.warn(
        `Bull Board is disabled (NODE_ENV=${nodeEnv}); returning 404 for ${req.originalUrl}`,
      );
      this.respondNotFound(req, res);
      return;
    }

    const username = this.readString('BULL_BOARD_USERNAME');
    const password = this.readString('BULL_BOARD_PASSWORD');

    if (!username || !password) {
      if (isProduction) {
        // Refuse to expose queue payloads (email data) with no credentials.
        this.logger.error(
          'Bull Board is enabled in production but BULL_BOARD_USERNAME/BULL_BOARD_PASSWORD are not set; refusing access',
        );
        this.respondNotFound(req, res);
        return;
      }

      // Local development convenience: no credentials configured, stay open.
      next();
      return;
    }

    const credentials = this.parseBasicAuth(req.headers.authorization);
    if (!credentials || !this.matches(credentials, username, password)) {
      res.setHeader(
        'WWW-Authenticate',
        `Basic realm="${BULL_BOARD_REALM}", charset="UTF-8"`,
      );
      res.status(401).json({
        statusCode: 401,
        message: 'Unauthorized',
      });
      return;
    }

    next();
  }

  private readString(key: string): string | undefined {
    const value = this.configService.get<string | undefined>(key);
    if (value === undefined || value === null) {
      return undefined;
    }
    const trimmed = String(value).trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private readBoolean(key: string): boolean | undefined {
    const value = this.configService.get<string | boolean | undefined>(key);
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    return String(value).toLowerCase() === 'true';
  }

  private parseBasicAuth(header?: string): BasicCredentials | null {
    if (!header) {
      return null;
    }

    const [scheme, encoded] = header.split(' ');
    if (!scheme || scheme.toLowerCase() !== 'basic' || !encoded) {
      return null;
    }

    let decoded: string;
    try {
      decoded = Buffer.from(encoded, 'base64').toString('utf8');
    } catch {
      return null;
    }

    const separator = decoded.indexOf(':');
    if (separator < 0) {
      return null;
    }

    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  }

  private matches(
    credentials: BasicCredentials,
    expectedUsername: string,
    expectedPassword: string,
  ): boolean {
    // Evaluate both comparisons so the response time does not leak which half
    // of the credentials was wrong.
    const usernameMatches = safeEqual(credentials.username, expectedUsername);
    const passwordMatches = safeEqual(credentials.password, expectedPassword);
    return usernameMatches && passwordMatches;
  }

  private respondNotFound(req: Request, res: Response): void {
    res.status(404).json({
      statusCode: 404,
      message: `Cannot GET ${req.originalUrl}`,
    });
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
