import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

@Injectable()
export class IpRateLimitGuard implements CanActivate {
  private readonly rateLimits = new Map<string, RateLimitEntry>();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(private readonly configService: ConfigService) {
    // Default: 100 requests per minute
    this.windowMs = this.configService.get<number>(
      'VERIFICATION_RATE_LIMIT_WINDOW_MS',
      60 * 1000,
    );
    this.maxRequests = this.configService.get<number>(
      'VERIFICATION_RATE_LIMIT_MAX_REQUESTS',
      100,
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const clientIp = this.getClientIp(request);
    const now = Date.now();

    // Clean up expired entries
    this.cleanupExpiredEntries(now);

    // Get or create rate limit entry for this IP
    const entry = this.rateLimits.get(clientIp) || {
      count: 0,
      resetTime: now + this.windowMs,
    };

    // Check if window has expired
    if (now > entry.resetTime) {
      entry.count = 0;
      entry.resetTime = now + this.windowMs;
    }

    // Increment request count
    entry.count++;

    // Update the map
    this.rateLimits.set(clientIp, entry);

    // Check if limit exceeded
    if (entry.count > this.maxRequests) {
      const resetInSeconds = Math.ceil((entry.resetTime - now) / 1000);

      throw new HttpException(
        {
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again in ${resetInSeconds} seconds.`,
          retryAfter: resetInSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Set rate limit headers
    const response = context.switchToHttp().getResponse();
    response.header('X-RateLimit-Limit', this.maxRequests.toString());
    response.header(
      'X-RateLimit-Remaining',
      Math.max(0, this.maxRequests - entry.count).toString(),
    );
    response.header('X-RateLimit-Reset', entry.resetTime.toString());

    return true;
  }

  private getClientIp(request: Request): string {
    // Check for forwarded IP headers (common in proxy setups)
    const forwardedFor = request.headers['x-forwarded-for'] as string;
    if (forwardedFor) {
      // Take the first IP if multiple are present
      return forwardedFor.split(',')[0].trim();
    }

    const realIp = request.headers['x-real-ip'] as string;
    if (realIp) {
      return realIp;
    }

    // Fallback to connection remote address
    return (
      request.connection.remoteAddress ||
      request.socket.remoteAddress ||
      'unknown'
    );
  }

  private cleanupExpiredEntries(now: number): void {
    for (const [ip, entry] of this.rateLimits.entries()) {
      if (now > entry.resetTime) {
        this.rateLimits.delete(ip);
      }
    }
  }

  /**
   * Get current rate limit status for an IP (useful for monitoring)
   */
  getRateLimitStatus(
    ip: string,
  ): { count: number; resetTime: number; remaining: number } | null {
    const entry = this.rateLimits.get(ip);
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.resetTime) {
      return {
        count: 0,
        resetTime: entry.resetTime,
        remaining: this.maxRequests,
      };
    }

    return {
      count: entry.count,
      resetTime: entry.resetTime,
      remaining: Math.max(0, this.maxRequests - entry.count),
    };
  }

  /**
   * Get all current rate limit entries (for monitoring/debugging)
   */
  getAllRateLimits(): Array<{ ip: string; count: number; resetTime: number }> {
    return Array.from(this.rateLimits.entries()).map(([ip, entry]) => ({
      ip,
      count: entry.count,
      resetTime: entry.resetTime,
    }));
  }
}
