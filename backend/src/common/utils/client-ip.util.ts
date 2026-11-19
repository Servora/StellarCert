import { isIP } from 'net';

/** Returned when no usable address can be determined for a request. */
export const UNKNOWN_IP = 'unknown';

/** The parts of an Express request the resolver reads. */
export interface ClientIpRequest {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  connection?: { remoteAddress?: string };
}

/**
 * Strip an IPv4-mapped IPv6 prefix so `::ffff:10.0.0.1` and `10.0.0.1` are
 * treated as the same address, and return undefined for anything that is not a
 * valid IP.
 */
export function normaliseIp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim().replace(/^\[|\]$/g, '');
  if (!trimmed) return undefined;

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  const candidate = mapped ? mapped[1] : trimmed;

  return isIP(candidate) ? candidate : undefined;
}

/** Parse a comma-separated `TRUSTED_PROXY_IPS` value into a set of valid addresses. */
export function parseTrustedProxyIps(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((ip) => normaliseIp(ip))
      .filter((ip): ip is string => ip !== undefined),
  );
}

/**
 * Parse an `X-Forwarded-For` header into validated addresses, left to right.
 * A header containing anything that is not a valid IP is rejected wholesale
 * rather than partially trusted.
 */
function parseForwardedChain(header: unknown): string[] {
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (typeof raw !== 'string' || raw.trim() === '') return [];

  const parts = raw.split(',').map((part) => normaliseIp(part));
  if (parts.some((part) => part === undefined)) return [];

  return parts as string[];
}

/**
 * Resolve the address a request should be attributed to.
 *
 * `X-Forwarded-For` and `X-Real-IP` are client-supplied, so they are only read
 * when the immediate peer is one of `trustedProxyIps`. With no trusted proxies
 * they are ignored entirely and the socket address is used. Behind trusted
 * proxies the chain is walked right to left; the first address that is not one
 * of ours is the client and anything further left is ignored.
 */
export function resolveClientIp(
  request: ClientIpRequest,
  trustedProxyIps: ReadonlySet<string>,
): string {
  const peer =
    normaliseIp(request.socket?.remoteAddress) ??
    normaliseIp(request.connection?.remoteAddress) ??
    UNKNOWN_IP;

  if (!trustedProxyIps.has(peer)) {
    return peer;
  }

  const chain = parseForwardedChain(request.headers['x-forwarded-for']);
  if (chain.length > 0) {
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      if (!trustedProxyIps.has(chain[index])) return chain[index];
    }
    return peer;
  }

  return normaliseIp(request.headers['x-real-ip']) ?? peer;
}

let cachedRaw: string | undefined;
let cachedSet: Set<string> = new Set();

/**
 * `resolveClientIp` using the process-wide `TRUSTED_PROXY_IPS` setting. Use this
 * wherever a client address is recorded (audit trails, verification history) so
 * every part of the app follows the same trusted-proxy rules.
 */
export function getClientIp(request: ClientIpRequest): string {
  const raw = process.env.TRUSTED_PROXY_IPS;
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedSet = parseTrustedProxyIps(raw);
  }
  return resolveClientIp(request, cachedSet);
}
