/** Default access-token lifetime, matching the `JWT_ACCESS_EXPIRES_IN` default. */
export const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Real lifetime (`exp - iat`, in seconds) of a signed JWT, so responses report
 * the token's actual `expiresIn` instead of a hard-coded value (#1119). Falls
 * back to the default when the token cannot be decoded.
 */
export function tokenLifetimeSeconds(
  token: string,
  fallback = DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
): number {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { iat?: unknown; exp?: unknown };
    if (typeof payload.exp === 'number' && typeof payload.iat === 'number') {
      return payload.exp - payload.iat;
    }
  } catch {
    // Not a decodable JWT; use the fallback.
  }
  return fallback;
}
