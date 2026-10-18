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
import { isIP } from 'net';

/** Returned when no usable address can be determined for a request. */
const UNKNOWN_IP = 'unknown';

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
  private readonly entries = new Map<string, RateLimitEntry>();

  async consume(key: string, windowMs: number, now: number): Promise<RateLimitEntry> {
    const existing = this.entries.get(key);
    const entry =
      !existing || now > existing.resetTime
        ? { count: 0, resetTime: now + windowMs }
        : existing;

    entry.count += 1;
    this.entries.set(key, entry);
    return entry;
  }

  async reset(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async prune(now: number): Promise<void> {
    for (const [key, entry] of this.entries.entries()) {
      if (now > entry.resetTime) this.entries.delete(key);
    }
  }
}

/**
 * Strip an IPv4-mapped IPv6 prefix so `::ffff:10.0.0.1` and `10.0.0.1` are
 * treated as the same address, and return undefined for anything that is not a
 * valid IP.
 */
function normaliseIp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim().replace(/^\[|\]$/g, '');
  if (!trimmed) return undefined;

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  const candidate = mapped ? mapped[1] : trimmed;

  return isIP(candidate) ? candidate : undefined;
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
  private readonly trustProxyHops: number;

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
    this.trustedProxyIps = new Set(
      this.configService
        .get<string>('TRUSTED_PROXY_IPS', '')
        .split(',')
        .map((ip) => normaliseIp(ip))
        .filter((ip): ip is string => ip !== undefined),
    );
    this.trustProxyHops = this.configService.get<number>('TRUST_PROXY_HOPS', 0);
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
   * Resolve the address a request should be counted against (#727).
   *
   * `X-Forwarded-For` and `X-Real-IP` are client-supplied, so they are only
   * read when the immediate peer is a proxy this deployment actually runs. With
   * no trusted proxies configured they are ignored entirely and the socket
   * address is used, which is the safe default.
   */
  private getClientIp(request: Request): string {
    const peer =
      normaliseIp(request.socket?.remoteAddress) ??
      normaliseIp(request.connection?.remoteAddress) ??
      UNKNOWN_IP;

    if (!this.isTrustedProxy(peer)) {
      return peer;
    }

    const chain = this.parseForwardedChain(request.headers['x-forwarded-for']);
    if (chain.length > 0) {
      // Walk right-to-left past proxies we control. The first address that is
      // not one of ours is the client; anything further left was appended by
      // the client itself and is ignored.
      for (let index = chain.length - 1; index >= 0; index -= 1) {
        if (!this.isTrustedProxy(chain[index])) return chain[index];
      }
      return peer;
    }

    return (
      normaliseIp(request.headers['x-real-ip']) ?? peer
    );
  }

  /**
   * Parse an `X-Forwarded-For` header into validated addresses, left to right.
   *
   * A header containing anything that is not a valid IP is rejected wholesale
   * rather than partially trusted.
   */
  private parseForwardedChain(header: unknown): string[] {
    const raw = Array.isArray(header) ? header.join(',') : header;
    if (typeof raw !== 'string' || raw.trim() === '') return [];

    const parts = raw.split(',').map((part) => normaliseIp(part));
    if (parts.some((part) => part === undefined)) return [];

    return parts as string[];
  }

  private isTrustedProxy(ip: string): boolean {
    return this.trustedProxyIps.has(ip);
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
