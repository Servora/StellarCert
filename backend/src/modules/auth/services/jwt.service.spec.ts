import { JwtManagementService } from './jwt.service';
import { JwtService as NestJwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { validate as uuidValidate, version as uuidVersion } from 'uuid';

/** Minimal in-memory cache that mirrors the cache-manager API used by the service. */
function makeCache() {
  const store = new Map<string, unknown>();
  return {
    store,
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key: string, value: unknown, _ttl?: number) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    del: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
}

/** Build a minimal service with a real NestJwtService so we can sign/verify real JWTs. */
function buildService(cache = makeCache()) {
  const nestJwt = new NestJwtService({ secret: 'test-secret' });

  const config = {
    get: jest.fn((key: string) => {
      const map: Record<string, string> = {
        JWT_ACCESS_SECRET: 'access-secret',
        JWT_REFRESH_SECRET: 'refresh-secret',
        JWT_ACCESS_EXPIRES_IN: '15m',
        JWT_REFRESH_EXPIRES_IN: '7d',
      };
      return map[key];
    }),
  } as unknown as ConfigService;

  const svc = new JwtManagementService(nestJwt, config, cache as any);
  return { svc, nestJwt, cache };
}

// ---------------------------------------------------------------------------
// generateAccessToken / generateRefreshToken – jti injection
// ---------------------------------------------------------------------------
describe('generateAccessToken', () => {
  it('embeds a valid UUID v4 jti claim', async () => {
    const { svc, nestJwt } = buildService();
    const token = await svc.generateAccessToken({
      sub: 'u1',
      email: 'a@b.com',
      role: 'USER',
    });
    const decoded = nestJwt.decode(token) as any;
    expect(decoded).toHaveProperty('jti');
    expect(uuidValidate(decoded.jti)).toBe(true);
    expect(uuidVersion(decoded.jti)).toBe(4);
  });

  it('generates distinct jti values on successive calls', async () => {
    const { svc, nestJwt } = buildService();
    const payload = { sub: 'u1', email: 'a@b.com', role: 'USER' };
    const t1 = await svc.generateAccessToken(payload);
    const t2 = await svc.generateAccessToken(payload);
    const j1 = (nestJwt.decode(t1) as any).jti;
    const j2 = (nestJwt.decode(t2) as any).jti;
    expect(j1).not.toEqual(j2);
  });
});

describe('generateRefreshToken', () => {
  it('embeds a valid UUID v4 jti claim', async () => {
    const { svc, nestJwt } = buildService();
    const token = await svc.generateRefreshToken({
      sub: 'u1',
      email: 'a@b.com',
      role: 'USER',
    });
    const decoded = nestJwt.decode(token) as any;
    expect(decoded).toHaveProperty('jti');
    expect(uuidValidate(decoded.jti)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// blacklistToken – keys cache by jti, NOT the raw token
// ---------------------------------------------------------------------------
describe('blacklistToken', () => {
  it('stores the entry under blacklisted_token:<jti>, not the raw token', async () => {
    const cache = makeCache();
    const { svc, nestJwt } = buildService(cache);

    const token = await svc.generateAccessToken({
      sub: 'u1',
      email: 'a@b.com',
      role: 'USER',
    });
    const jti = (nestJwt.decode(token) as any).jti as string;

    await svc.blacklistToken(token);

    // The cache key must be keyed by jti
    expect(cache.store.has(`blacklisted_token:${jti}`)).toBe(true);
    // The raw token must NOT be a cache key
    const rawKeyExists = [...cache.store.keys()].some((k) =>
      k.includes(token),
    );
    expect(rawKeyExists).toBe(false);
  });

  it('uses a sha256 hash fallback when the token has no jti', async () => {
    const cache = makeCache();
    const { svc, nestJwt } = buildService(cache);

    // Sign a token without jti manually
    const noJtiToken = await nestJwt.signAsync(
      { sub: 'u2', email: 'b@c.com', role: 'USER' },
      { secret: 'access-secret', expiresIn: '15m' },
    );

    await svc.blacklistToken(noJtiToken);

    const { createHash } = await import('crypto');
    const expectedKey = `blacklisted_token:${createHash('sha256').update(noJtiToken).digest('hex')}`;
    expect(cache.store.has(expectedKey)).toBe(true);
    // Raw token not in cache
    const rawKeyExists = [...cache.store.keys()].some((k) =>
      k.includes(noJtiToken),
    );
    expect(rawKeyExists).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isTokenBlacklisted – consistent with blacklistToken
// ---------------------------------------------------------------------------
describe('isTokenBlacklisted', () => {
  it('returns false for a fresh token', async () => {
    const { svc } = buildService();
    const token = await svc.generateAccessToken({
      sub: 'u1',
      email: 'a@b.com',
      role: 'USER',
    });
    expect(await svc.isTokenBlacklisted(token)).toBe(false);
  });

  it('returns true after blacklistToken is called', async () => {
    const { svc } = buildService();
    const token = await svc.generateAccessToken({
      sub: 'u1',
      email: 'a@b.com',
      role: 'USER',
    });
    await svc.blacklistToken(token);
    expect(await svc.isTokenBlacklisted(token)).toBe(true);
  });

  it('blacklisting one token does not affect another token for the same user', async () => {
    const { svc } = buildService();
    const payload = { sub: 'u1', email: 'a@b.com', role: 'USER' };
    const t1 = await svc.generateAccessToken(payload);
    const t2 = await svc.generateAccessToken(payload);

    await svc.blacklistToken(t1);

    expect(await svc.isTokenBlacklisted(t1)).toBe(true);
    expect(await svc.isTokenBlacklisted(t2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// recordFailed2faAttempt – keys by jti
// ---------------------------------------------------------------------------
describe('recordFailed2faAttempt', () => {
  it('increments attempt count and returns invalidated=false below threshold', async () => {
    const cache = makeCache();
    const { svc, nestJwt } = buildService(cache);
    const token = await svc.generateAccessToken({
      sub: 'u1',
      email: 'a@b.com',
      role: 'USER',
    });
    const jti = (nestJwt.decode(token) as any).jti as string;

    const result = await svc.recordFailed2faAttempt(token, 3);

    expect(result).toEqual({ attempts: 1, invalidated: false });
    expect(cache.store.get(`2fa_attempts:${jti}`)).toBe(1);
    // Raw token must not appear as a cache key
    const rawKeyExists = [...cache.store.keys()].some((k) =>
      k.includes(token),
    );
    expect(rawKeyExists).toBe(false);
  });

  it('blacklists the token and returns invalidated=true when maxAttempts is reached', async () => {
    const cache = makeCache();
    const { svc, nestJwt } = buildService(cache);
    const token = await svc.generateAccessToken({
      sub: 'u1',
      email: 'a@b.com',
      role: 'USER',
    });
    const jti = (nestJwt.decode(token) as any).jti as string;

    // Two prior failures
    await svc.recordFailed2faAttempt(token, 3);
    await svc.recordFailed2faAttempt(token, 3);
    const result = await svc.recordFailed2faAttempt(token, 3);

    expect(result).toEqual({ attempts: 3, invalidated: true });
    expect(cache.store.has(`blacklisted_token:${jti}`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// clear2faAttempts – keys by jti
// ---------------------------------------------------------------------------
describe('clear2faAttempts', () => {
  it('removes the attempt counter keyed by jti', async () => {
    const cache = makeCache();
    const { svc, nestJwt } = buildService(cache);
    const token = await svc.generateAccessToken({
      sub: 'u1',
      email: 'a@b.com',
      role: 'USER',
    });
    const jti = (nestJwt.decode(token) as any).jti as string;

    await svc.recordFailed2faAttempt(token, 3);
    expect(cache.store.has(`2fa_attempts:${jti}`)).toBe(true);

    await svc.clear2faAttempts(token);
    expect(cache.store.has(`2fa_attempts:${jti}`)).toBe(false);
  });
});
