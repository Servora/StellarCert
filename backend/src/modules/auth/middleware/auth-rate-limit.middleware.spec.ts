import { AuthRateLimitMiddleware } from './auth-rate-limit.middleware';

describe('AuthRateLimitMiddleware', () => {
  const makeCache = (start: any = 0) => {
    const store = new Map<string, any>();
    return {
      store,
      get: jest.fn((k: string) => store.get(k) ?? start),
      set: jest.fn((k: string, v: any, ttl?: number) => {
        store.set(k, v);
      }),
    } as any;
  };

  it('allows requests under the limit and increments the counter using ms TTL', async () => {
    const cache = makeCache(0);
    const mw = new AuthRateLimitMiddleware(cache);

    const req: any = {
      ip: '1.2.3.4',
      headers: {},
      socket: { remoteAddress: '1.2.3.4' },
      app: { get: () => true },
    };
    const res: any = {};
    const next = jest.fn();

    await mw.use(req, res, next);

    expect(cache.get).toHaveBeenCalledWith('rate:auth:1.2.3.4');
    expect(cache.set).toHaveBeenCalledWith(
      'rate:auth:1.2.3.4',
      expect.objectContaining({ count: 1 }),
      expect.any(Number),
    );
    // Ensure TTL is in milliseconds (~60000ms)
    const setCall = cache.set.mock.calls[0];
    expect(setCall[2]).toBeGreaterThan(50000);
    expect(setCall[2]).toBeLessThanOrEqual(60000);
    expect(next).toHaveBeenCalled();
  });

  it('preserves the original window expiresAt on subsequent increments', async () => {
    const cache = makeCache(0);
    const mw = new AuthRateLimitMiddleware(cache);

    const fixedNow = 1000000;
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

    const req: any = {
      ip: '1.2.3.4',
      headers: {},
      socket: { remoteAddress: '1.2.3.4' },
      app: { get: () => true },
    };
    const res: any = {};
    const next = jest.fn();

    // First request at t = 1000000
    await mw.use(req, res, next);
    expect(cache.set).toHaveBeenLastCalledWith(
      'rate:auth:1.2.3.4',
      { count: 1, expiresAt: fixedNow + 60000 },
      60000,
    );

    // Second request 20 seconds later at t = 1020000
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow + 20000);
    await mw.use(req, res, next);

    // Count should be 2, expiresAt remains the same, remaining TTL should be 40000ms (NOT reset to 60000)
    expect(cache.set).toHaveBeenLastCalledWith(
      'rate:auth:1.2.3.4',
      { count: 2, expiresAt: fixedNow + 60000 },
      40000,
    );

    jest.restoreAllMocks();
  });

  it('blocks requests once the limit is reached', async () => {
    const cache = makeCache(5);
    const mw = new AuthRateLimitMiddleware(cache);

    const json = jest.fn();
    const setHeader = jest.fn();
    const status = jest.fn(() => ({ json }));

    const req: any = {
      ip: '9.9.9.9',
      headers: {},
      socket: { remoteAddress: '9.9.9.9' },
      app: { get: () => true },
    };
    const res: any = { status, setHeader };
    const next = jest.fn();

    await mw.use(req, res, next);

    expect(setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith({
      statusCode: 429,
      message: 'Too many requests. Please try again later.',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('ignores spoofed X-Forwarded-For header when trust proxy is not enabled', async () => {
    const cache = makeCache(0);
    const configServiceMock: any = {
      get: jest.fn().mockReturnValue(false),
    };
    const mw = new AuthRateLimitMiddleware(cache, configServiceMock);

    const req: any = {
      ip: '10.0.0.1',
      headers: { 'x-forwarded-for': '198.51.100.99' },
      socket: { remoteAddress: '10.0.0.1' },
      app: { get: () => false },
    };
    const res: any = {};
    const next = jest.fn();

    await mw.use(req, res, next);

    // Must key on the socket/real IP 10.0.0.1, NOT the spoofed 198.51.100.99
    expect(cache.get).toHaveBeenCalledWith('rate:auth:10.0.0.1');
  });

  it('uses forwarded IP when trust proxy is enabled', async () => {
    const cache = makeCache(0);
    const configServiceMock: any = {
      get: jest.fn().mockReturnValue(true),
    };
    const mw = new AuthRateLimitMiddleware(cache, configServiceMock);

    const req: any = {
      headers: { 'x-forwarded-for': '203.0.113.195, 10.0.0.1' },
      socket: { remoteAddress: '10.0.0.1' },
      app: { get: () => true },
    };
    const res: any = {};
    const next = jest.fn();

    await mw.use(req, res, next);

    // Sanitized first IP
    expect(cache.get).toHaveBeenCalledWith('rate:auth:203.0.113.195');
  });

  it('fails closed (503) on cache outage / error to prevent brute-force bypass', async () => {
    const cache: any = {
      get: jest.fn().mockRejectedValue(new Error('Redis connection failed')),
      set: jest.fn(),
    };
    const mw = new AuthRateLimitMiddleware(cache);

    const json = jest.fn();
    const status = jest.fn(() => ({ json }));

    const req: any = {
      ip: '1.2.3.4',
      headers: {},
      socket: { remoteAddress: '1.2.3.4' },
      app: { get: () => true },
    };
    const res: any = { status };
    const next = jest.fn();

    await mw.use(req, res, next);

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      statusCode: 503,
      message:
        'Authentication service temporarily unavailable. Please try again later.',
    });
    expect(next).not.toHaveBeenCalled();
  });
});

