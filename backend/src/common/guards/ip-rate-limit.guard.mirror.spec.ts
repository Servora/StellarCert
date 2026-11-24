import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InMemoryRateLimitStore,
  IpRateLimitGuard,
} from './ip-rate-limit.guard';

function createContext(ip: string): ExecutionContext {
  const responseHeaders = new Map<string, string>();
  const req: any = {
    ip,
    socket: { remoteAddress: ip },
    headers: {},
  };
  const res: any = {
    header: jest.fn((name: string, value: string) => {
      responseHeaders.set(name, value);
    }),
  };

  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

describe('IpRateLimitGuard mirror LRU cap (#1302)', () => {
  it('enforces a hard cap on mirror entries and evicts least-recently-used IPs within a single window', async () => {
    const config = new ConfigService({
      IP_RATE_LIMIT_MIRROR_MAX_ENTRIES: 3,
      VERIFICATION_RATE_LIMIT_WINDOW_MS: 60_000,
      VERIFICATION_RATE_LIMIT_MAX_REQUESTS: 100,
    });
    const guard = new IpRateLimitGuard(config, new InMemoryRateLimitStore());

    await guard.canActivate(createContext('10.0.0.1'));
    await guard.canActivate(createContext('10.0.0.2'));
    await guard.canActivate(createContext('10.0.0.3'));

    // Touch 10.0.0.1 so 10.0.0.2 becomes the least recently used entry.
    guard.getRateLimitStatus('10.0.0.1');

    // Inserting a 4th active IP within the same window must evict 10.0.0.2.
    await guard.canActivate(createContext('10.0.0.4'));

    const entries = guard.getAllRateLimits();
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.ip)).not.toContain('10.0.0.2');
    expect(entries.map((e) => e.ip)).toEqual(
      expect.arrayContaining(['10.0.0.1', '10.0.0.3', '10.0.0.4']),
    );
  });
});
