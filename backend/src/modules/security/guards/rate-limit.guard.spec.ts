import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { RateLimitGuard } from './rate-limit.guard';
import { InMemoryRateLimitStore } from '../../../common/guards/ip-rate-limit.guard';

function context(
  peer: string,
  headers: Record<string, string> = {},
  path = '/certificates',
) {
  const response = { setHeader: jest.fn() };
  const request = {
    method: 'GET',
    path,
    originalUrl: path,
    url: path,
    headers,
    socket: { remoteAddress: peer },
  };
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { ctx, response };
}

function makeGuard(
  env: Record<string, string | number>,
  store?: InMemoryRateLimitStore,
) {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  const reflector = {
    getAllAndOverride: () => undefined,
  } as unknown as Reflector;
  const logging = { warn: jest.fn() };
  const apiKeys = { resolveIssuer: jest.fn(), consume: jest.fn() };
  return new RateLimitGuard(
    reflector,
    config,
    logging as never,
    apiKeys as never,
    store,
  );
}

describe('RateLimitGuard (app-wide)', () => {
  it('blocks after the limit using the shared store', async () => {
    const guard = makeGuard(
      { RATE_LIMIT_DEFAULT_MAX_REQUESTS: 2 },
      new InMemoryRateLimitStore(),
    );
    const { ctx } = context('203.0.113.1');

    await guard.canActivate(ctx);
    await guard.canActivate(ctx);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
  });

  it('shares counters between guard instances that share a store', async () => {
    const store = new InMemoryRateLimitStore();
    const podA = makeGuard({ RATE_LIMIT_DEFAULT_MAX_REQUESTS: 2 }, store);
    const podB = makeGuard({ RATE_LIMIT_DEFAULT_MAX_REQUESTS: 2 }, store);
    const { ctx } = context('203.0.113.1');

    await podA.canActivate(ctx);
    await podB.canActivate(ctx);
    await expect(podA.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
  });

  it('cannot be bypassed by a spoofed X-Forwarded-For header', async () => {
    const guard = makeGuard(
      { RATE_LIMIT_DEFAULT_MAX_REQUESTS: 1 },
      new InMemoryRateLimitStore(),
    );

    await guard.canActivate(
      context('203.0.113.1', { 'x-forwarded-for': '1.1.1.1' }).ctx,
    );
    await expect(
      guard.canActivate(
        context('203.0.113.1', { 'x-forwarded-for': '2.2.2.2' }).ctx,
      ),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('keys on the forwarded client only when the peer is a trusted proxy', async () => {
    const guard = makeGuard(
      { RATE_LIMIT_DEFAULT_MAX_REQUESTS: 1, TRUSTED_PROXY_IPS: '10.0.0.1' },
      new InMemoryRateLimitStore(),
    );

    await guard.canActivate(
      context('10.0.0.1', { 'x-forwarded-for': '198.51.100.4' }).ctx,
    );
    // A different client behind the same proxy has its own bucket.
    await expect(
      guard.canActivate(
        context('10.0.0.1', { 'x-forwarded-for': '198.51.100.5' }).ctx,
      ),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(
        context('10.0.0.1', { 'x-forwarded-for': '198.51.100.4' }).ctx,
      ),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
