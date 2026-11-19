import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { RateLimitService } from '../../../common/rate-limiting/rate-limit.service';
import {
  InMemoryRateLimitStore,
  RATE_LIMIT_STORE,
} from '../../../common/guards/ip-rate-limit.guard';
import type { RateLimitStore } from '../../../common/guards/ip-rate-limit.guard';
import {
  parseTrustedProxyIps,
  resolveClientIp,
} from '../../../common/utils/client-ip.util';
import { LoggingService } from '../../../common/logging/logging.service';
import { rateLimitsDisabledForTests } from '../../../common/rate-limiting/rate-limit-test-switch';
import {
  RATE_LIMIT_OPTIONS_KEY,
  RateLimitOptions,
} from '../decorators/rate-limit.decorator';

interface RequestWithContext extends Request {
  user?: { id?: string; sub?: string };
  issuer?: { id: string; tier: string };
}

interface GuardRateResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  reason?: string;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly store: RateLimitStore;
  private readonly trustedProxyIps: Set<string>;
  private readonly defaultWindowMs: number;
  private readonly defaultMaxRequests: number;
  private readonly bruteForceWindowMs: number;
  private readonly bruteForceMaxAttempts: number;

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService,
    private readonly apiKeyRateLimitService: RateLimitService,
    @Optional() @Inject(RATE_LIMIT_STORE) store?: RateLimitStore,
  ) {
    // Shared store when one is bound (Redis); its own bounded in-memory one otherwise.
    this.store = store ?? new InMemoryRateLimitStore();
    this.trustedProxyIps = parseTrustedProxyIps(
      this.configService.get<string>('TRUSTED_PROXY_IPS', ''),
    );
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';

    this.defaultWindowMs =
      Number(this.configService.get('RATE_LIMIT_DEFAULT_WINDOW_MS')) || 60_000;

    this.defaultMaxRequests =
      Number(this.configService.get('RATE_LIMIT_DEFAULT_MAX_REQUESTS')) ||
      (isProd ? 120 : 1_000);

    this.bruteForceWindowMs =
      Number(this.configService.get('AUTH_BRUTE_FORCE_WINDOW_MS')) || 60_000;

    this.bruteForceMaxAttempts =
      Number(this.configService.get('AUTH_BRUTE_FORCE_MAX_ATTEMPTS')) || 5;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (rateLimitsDisabledForTests()) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithContext>();
    const response = http.getResponse<Response>();
    const routeKey = this.routeKey(request);

    await this.enforceApiKeyRateLimit(request, response, routeKey);
    await this.enforceRequestRateLimit(context, request, response, routeKey);

    return true;
  }

  private async enforceApiKeyRateLimit(
    request: RequestWithContext,
    response: Response,
    routeKey: string,
  ): Promise<void> {
    const apiKey = this.extractApiKey(request);
    if (!apiKey) {
      return;
    }

    const issuer = await this.apiKeyRateLimitService.resolveIssuer(apiKey);

    if (!issuer) {
      this.loggingService.warn('Blocked request with invalid API key', {
        path: request.originalUrl,
        method: request.method,
        ip: request.ip,
      });
      throw new UnauthorizedException('Invalid API key');
    }

    request.issuer = issuer;

    const result = await this.apiKeyRateLimitService.consume(
      issuer.id,
      issuer.tier,
      routeKey,
    );

    response.setHeader('X-ApiKey-RateLimit-Limit', result.limit.toString());
    response.setHeader(
      'X-ApiKey-RateLimit-Remaining',
      result.remaining.toString(),
    );
    response.setHeader(
      'X-ApiKey-RateLimit-Reset',
      Math.floor(result.resetAt / 1000).toString(),
    );

    if (!result.allowed) {
      this.logBlockedRequest(request, routeKey, 'api-key-limit-exceeded');
      this.throwRateLimitError(response, result.resetAt);
    }
  }

  private async enforceRequestRateLimit(
    context: ExecutionContext,
    request: RequestWithContext,
    response: Response,
    routeKey: string,
  ): Promise<void> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_OPTIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    const isBruteForceRoute = this.isBruteForceRoute(request);
    const limit = isBruteForceRoute
      ? this.bruteForceMaxAttempts
      : options?.limit || this.defaultMaxRequests;
    const windowMs = isBruteForceRoute
      ? this.bruteForceWindowMs
      : options?.windowMs || this.defaultWindowMs;

    const bucketKey = this.buildBucketKey(
      request,
      routeKey,
      options,
      isBruteForceRoute,
    );
    const result = await this.consume(
      bucketKey,
      limit,
      windowMs,
      isBruteForceRoute,
    );

    response.setHeader('X-RateLimit-Limit', result.limit.toString());
    response.setHeader('X-RateLimit-Remaining', result.remaining.toString());
    response.setHeader(
      'X-RateLimit-Reset',
      Math.floor(result.resetAt / 1000).toString(),
    );

    if (!result.allowed) {
      this.logBlockedRequest(
        request,
        routeKey,
        result.reason || 'rate-limited',
      );
      this.throwRateLimitError(response, result.resetAt);
    }
  }

  private async consume(
    key: string,
    limit: number,
    windowMs: number,
    isBruteForceRoute: boolean,
  ): Promise<GuardRateResult> {
    const entry = await this.store.consume(key, windowMs, Date.now());
    const allowed = entry.count <= limit;

    return {
      allowed,
      limit,
      remaining: Math.max(limit - entry.count, 0),
      resetAt: entry.resetTime,
      reason: allowed
        ? undefined
        : isBruteForceRoute
          ? 'brute-force-protection-triggered'
          : 'global-rate-limit-exceeded',
    };
  }

  private buildBucketKey(
    request: RequestWithContext,
    routeKey: string,
    options: RateLimitOptions | undefined,
    isBruteForceRoute: boolean,
  ): string {
    if (isBruteForceRoute) {
      return `bruteforce:${this.clientIp(request)}:${routeKey}`;
    }

    const keyBy = options?.keyBy || 'user';

    if (keyBy === 'apiKey') {
      const apiKey = this.extractApiKey(request);
      if (apiKey) {
        return `apiKey:${this.hashValue(apiKey)}:${routeKey}`;
      }
    }

    if (keyBy === 'user') {
      const userId =
        request.user?.id || request.user?.sub || request.issuer?.id;
      if (userId) {
        return `user:${userId}:${routeKey}`;
      }
    }

    return `ip:${this.clientIp(request)}:${routeKey}`;
  }

  private clientIp(request: Request): string {
    return resolveClientIp(request, this.trustedProxyIps);
  }

  private routeKey(request: Request): string {
    const path = request.route?.path || request.path || request.originalUrl;
    return `${request.method}:${path}`;
  }

  private extractApiKey(request: Request): string | undefined {
    const apiKeyHeader = request.headers['x-api-key'];

    if (typeof apiKeyHeader === 'string') {
      return apiKeyHeader;
    }

    if (Array.isArray(apiKeyHeader)) {
      return apiKeyHeader[0];
    }

    return undefined;
  }

  private isBruteForceRoute(request: Request): boolean {
    if (request.method !== 'POST') {
      return false;
    }

    const normalizedPath = (request.originalUrl || request.url).toLowerCase();

    return [
      '/auth/login',
      '/auth/register',
      '/auth/refresh',
      '/auth/forgot-password',
      '/auth/reset-password',
    ].some((segment) => normalizedPath.includes(segment));
  }

  private throwRateLimitError(response: Response, resetAt: number): never {
    const retryAfterSeconds = Math.max(
      Math.ceil((resetAt - Date.now()) / 1000),
      1,
    );

    response.setHeader('Retry-After', retryAfterSeconds.toString());

    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many requests',
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private logBlockedRequest(
    request: RequestWithContext,
    routeKey: string,
    reason: string,
  ): void {
    this.loggingService.warn('Blocked request by security rate limiter', {
      reason,
      path: request.originalUrl,
      method: request.method,
      routeKey,
      ip: this.clientIp(request),
      userId: request.user?.id || request.user?.sub || request.issuer?.id,
    });
  }

  private hashValue(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 16);
  }
}
