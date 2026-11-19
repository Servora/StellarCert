import {
  getClientIp,
  normaliseIp,
  parseTrustedProxyIps,
  resolveClientIp,
} from './client-ip.util';

function req(
  peer: string | undefined,
  headers: Record<string, string | string[]> = {},
) {
  return { headers, socket: { remoteAddress: peer } };
}

describe('client-ip.util', () => {
  describe('normaliseIp', () => {
    it('unwraps IPv4-mapped IPv6 and rejects non-addresses', () => {
      expect(normaliseIp('::ffff:10.0.0.1')).toBe('10.0.0.1');
      expect(normaliseIp(' [2001:db8::1] ')).toBe('2001:db8::1');
      expect(normaliseIp('not-an-ip')).toBeUndefined();
      expect(normaliseIp(undefined)).toBeUndefined();
    });
  });

  describe('resolveClientIp', () => {
    const trusted = parseTrustedProxyIps('10.0.0.1, 10.0.0.2');

    it('uses the socket address when no proxy is trusted', () => {
      const ip = resolveClientIp(
        req('203.0.113.9', { 'x-forwarded-for': '1.2.3.4' }),
        new Set(),
      );
      expect(ip).toBe('203.0.113.9');
    });

    it('ignores forwarded headers from an untrusted peer', () => {
      const ip = resolveClientIp(
        req('203.0.113.9', { 'x-forwarded-for': '1.2.3.4' }),
        trusted,
      );
      expect(ip).toBe('203.0.113.9');
    });

    it('takes the first non-proxy address from the right behind trusted proxies', () => {
      const ip = resolveClientIp(
        req('10.0.0.1', {
          'x-forwarded-for': '6.6.6.6, 198.51.100.4, 10.0.0.2',
        }),
        trusted,
      );
      expect(ip).toBe('198.51.100.4');
    });

    it('rejects a forwarded chain containing garbage and falls back to the peer', () => {
      const ip = resolveClientIp(
        req('10.0.0.1', { 'x-forwarded-for': '198.51.100.4, <script>' }),
        trusted,
      );
      expect(ip).toBe('10.0.0.1');
    });

    it('falls back to X-Real-IP, then the peer, behind a trusted proxy', () => {
      expect(
        resolveClientIp(
          req('10.0.0.1', { 'x-real-ip': '198.51.100.7' }),
          trusted,
        ),
      ).toBe('198.51.100.7');
      expect(resolveClientIp(req('10.0.0.1'), trusted)).toBe('10.0.0.1');
    });

    it('reports unknown when there is no usable address', () => {
      expect(resolveClientIp(req(undefined), new Set())).toBe('unknown');
    });
  });

  describe('getClientIp', () => {
    const original = process.env.TRUSTED_PROXY_IPS;
    afterEach(() => {
      if (original === undefined) delete process.env.TRUSTED_PROXY_IPS;
      else process.env.TRUSTED_PROXY_IPS = original;
    });

    it('follows TRUSTED_PROXY_IPS from the environment', () => {
      const request = req('10.0.0.1', { 'x-forwarded-for': '198.51.100.4' });

      delete process.env.TRUSTED_PROXY_IPS;
      expect(getClientIp(request)).toBe('10.0.0.1');

      process.env.TRUSTED_PROXY_IPS = '10.0.0.1';
      expect(getClientIp(request)).toBe('198.51.100.4');
    });
  });
});
