import { AuthRateLimitMiddleware } from './auth-rate-limit.middleware';

describe('AuthRateLimitMiddleware', () => {
  const makeCache = (start = 0) => {
    const store = new Map<string, number>();
    return {
      get: jest.fn((k: string) => store.get(k) || start),
      set: jest.fn((k: string, v: number, opts?: any) => {
        store.set(k, v);
      }),
    } as any;
  };

  it('allows requests under the limit and increments the counter', async () => {
    const cache = makeCache(0);
    const mw = new AuthRateLimitMiddleware(cache);

    const req: any = {
      ip: '1.2.3.4',
      headers: {},
      connection: { remoteAddress: '1.2.3.4' },
    };
    const res: any = {};
    const next = jest.fn();

    await mw.use(req, res, next);

    expect(cache.get).toHaveBeenCalled();
    expect(cache.set).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
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
      connection: { remoteAddress: '9.9.9.9' },
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
});
