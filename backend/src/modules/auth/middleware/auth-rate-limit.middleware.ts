import { Injectable, NestMiddleware, Inject } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

@Injectable()
export class AuthRateLimitMiddleware implements NestMiddleware {
  private readonly limit = 5;
  private readonly windowSeconds = 60; // 1 minute

  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const ip =
      req.ip ||
      (req.headers['x-forwarded-for'] as string) ||
      req.connection.remoteAddress ||
      'unknown';
    const key = `rate:auth:${String(ip)}`;

    try {
      const existing = (await this.cacheManager.get<number>(key)) || 0;

      if (existing >= this.limit) {
        res.setHeader('Retry-After', String(this.windowSeconds));
        res.status(429).json({
          statusCode: 429,
          message: 'Too many requests. Please try again later.',
        });
        return;
      }

      await this.cacheManager.set<number>(key, existing + 1, {
        ttl: this.windowSeconds,
      } as any);

      next();
    } catch (err) {
      // On cache errors, allow the request (fail-open) but log via console
      // so that auth isn't blocked by cache outages.

      console.warn('AuthRateLimitMiddleware cache error', err);
      next();
    }
  }
}
