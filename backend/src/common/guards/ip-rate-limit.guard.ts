import {
  Inject,
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { parseTrustedProxyIps, resolveClientIp } from '../utils/client-ip.util';

export interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/** DI token a shared store implementation can be bound to (#726). */
export const RATE_LIMIT_STORE = 'IP_RATE_LIMIT_STORE';

/**
 * Authoritative request counter store.
 *
 * `consume` MUST apply the read-modify-write as a single atomic operation. A
 * plain get-then-set is racy the moment two instances can reach the same key,
 * which is exactly the case a shared store exists to solve: against Redis that
 * means `INCR` plus `EXPIRE` in one round trip or script, not two commands.
 */
export interface RateLimitStore {
  consume(key: string, windowMs: number, now: number): Promise<RateLimitEntry>;
  reset(key: string): Promise<void>;
  prune(now: number): Promise<void>;
}

/**
 * Single-process store backed by a `Map`.
 *
 * Retained as the default so the guard still works with no extra wiring, but it
 * is **not** safe for multi-replica deployments: every pod keeps its own
 * counter, so a client can round-robin across instances to multiply its
 * effective limit, and all state is lost on restart. Register a shared
 * implementation against {@link RATE_LIMIT_STORE} to fix that.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private static readonly SWEEP_INTERVAL_MS = 60_000;

  private readonly entries = new Map<string, RateLimitEntry>();
  private lastSweep = 0;

  async consume(
    key: string,
    windowMs: number,
    now: number,
  ): Promise<RateLimitEntry> {
    // Drop expired counters now and then so the map cannot grow without bound.
    if (now - this.lastSweep >= InMemoryRateLimitStore.SWEEP_INTERVAL_MS) {
      this.lastSweep = now;
      await this.prune(now);
    }

    const existing = this.entries.get(key);
    const entry =
      !existing || now > existing.resetTime
        ? { count: 0, resetTime: now + windowMs }
        : existing;

    entry.count += 1;
    this.entries.set(key, entry);
    // Return a snapshot: callers must not see (or mutate) the live counter.
    return { ...entry };
  }

  reset(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }

  prune(now: number): Promise<void> {
    for (const [key, entry] of this.entries.entries()) {
      if (now > entry.resetTime) this.entries.delete(key);
    }
    return Promise.resolve();
  }
}

@Injectable()
export class IpRateLimitGuard implements CanActivate {
  /**
   * Best-effort per-instance view of the counters, used only to answer the
   * synchronous monitoring endpoints. This is NOT the authoritative counter —
   * that lives in {@link store}.
   */
  private readonly mirror = new Map<string, RateLimitEntry>();

  private readonly store: RateLimitStore;
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly trustedProxyIps: Set<string>;

  constructor(
    private readonly configService: ConfigService,
    @Optional() @Inject(RATE_LIMIT_STORE) store?: RateLimitStore,
  ) {
    this.store = store ?? new InMemoryRateLimitStore();

    // Default: 100 requests per minute
    this.windowMs = this.configService.get<number>(
      'VERIFICATION_RATE_LIMIT_WINDOW_MS',
      60 * 1000,
    );
    this.maxRequests = this.configService.get<number>(
      'VERIFICATION_RATE_LIMIT_MAX_REQUESTS',
      100,
    );

    // Empty by default: forwarded headers are ignored until an operator states
    // which peers are allowed to set them.
    this.trustedProxyIps = parseTrustedProxyIps(
      this.configService.get<string>('TRUSTED_PROXY_IPS', ''),
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const clientIp = this.getClientIp(request);
    const now = Date.now();

    const entry = await this.store.consume(clientIp, this.windowMs, now);

    // Keep the monitoring mirror current and bounded.
    this.mirror.set(clientIp, entry);
    this.pruneMirror(now);

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

  /**
   * Resolve the address a request should be counted against (#727). Forwarded
   * headers are only honoured from the configured trusted proxies; see
   * {@link resolveClientIp}.
   */
  private getClientIp(request: Request): string {
    return resolveClientIp(request, this.trustedProxyIps);
  }

  private pruneMirror(now: number): void {
    for (const [ip, entry] of this.mirror.entries()) {
      if (now > entry.resetTime) this.mirror.delete(ip);
    }
  }

  /**
   * Get current rate limit status for an IP (useful for monitoring).
   *
   * Synchronous by contract — the monitoring controller returns this straight
   * into a response — so it reads the local mirror and is an eventually
   * consistent, per-instance view rather than the authoritative counter.
   */
  getRateLimitStatus(
    ip: string,
  ): { count: number; resetTime: number; remaining: number } | null {
    const entry = this.mirror.get(ip);
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
   * Get all current rate limit entries (for monitoring/debugging).
   *
   * Per-instance and eventually consistent, for the same reason as
   * {@link getRateLimitStatus}.
   */
  getAllRateLimits(): Array<{ ip: string; count: number; resetTime: number }> {
    return Array.from(this.mirror.entries()).map(([ip, entry]) => ({
      ip,
      count: entry.count,
      resetTime: entry.resetTime,
    }));
  }

  /**
   * Drop a client's counter. Exposed so an operator or a successful sign-in can
   * clear a counter without waiting for the window to expire.
   */
  async reset(ip: string): Promise<void> {
    this.mirror.delete(ip);
    await this.store.reset(ip);
  }
}
