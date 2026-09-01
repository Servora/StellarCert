import * as dns from 'dns';
import { validateWebhookUrl, isPrivateHostSync } from './ssrf.utils';

// Mock DNS resolution
jest.mock('dns', () => ({
  resolve4: jest.fn(),
  resolve6: jest.fn(),
}));

const mockResolve4 = dns.resolve4 as jest.MockedFunction<typeof dns.resolve4>;
const mockResolve6 = dns.resolve6 as jest.MockedFunction<typeof dns.resolve6>;

function mockDnsSuccess(ipv4: string[] = [], ipv6: string[] = []) {
  mockResolve4.mockImplementation((_hostname, cb) => {
    cb(null, ipv4);
  });
  mockResolve6.mockImplementation((_hostname, cb) => {
    cb(null, ipv6);
  });
}

function mockDnsError() {
  mockResolve4.mockImplementation((_hostname, cb) => {
    cb(new Error('ENOTFOUND'), []);
  });
  mockResolve6.mockImplementation((_hostname, cb) => {
    cb(new Error('ENOTFOUND'), []);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SSRF Protection', () => {
  describe('validateWebhookUrl', () => {
    describe('should reject non-HTTPS URLs', () => {
      it('should reject http:// URLs', async () => {
        const result = await validateWebhookUrl('http://example.com/webhook');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('HTTPS');
      });

      it('should reject ftp:// URLs', async () => {
        const result = await validateWebhookUrl('ftp://example.com/webhook');
        expect(result.valid).toBe(false);
      });

      it('should reject file:// URLs', async () => {
        const result = await validateWebhookUrl('file:///etc/passwd');
        expect(result.valid).toBe(false);
      });

      it('should reject data: URIs', async () => {
        const result = await validateWebhookUrl(
          'data:text/html,<script>alert(1)</script>',
        );
        expect(result.valid).toBe(false);
      });
    });

    describe('should reject private/internal hostnames', () => {
      it('should reject localhost', async () => {
        const result = await validateWebhookUrl('https://localhost/webhook');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('not allowed');
      });

      it('should reject 127.0.0.1', async () => {
        const result = await validateWebhookUrl('https://127.0.0.1/webhook');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('not allowed');
      });

      it('should reject 0.0.0.0', async () => {
        const result = await validateWebhookUrl('https://0.0.0.0/webhook');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('not allowed');
      });

      it('should reject AWS metadata endpoint', async () => {
        const result = await validateWebhookUrl(
          'https://169.254.169.254/latest/meta-data/',
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain('not allowed');
      });

      it('should reject GCP metadata endpoint', async () => {
        const result = await validateWebhookUrl(
          'https://metadata.google.internal/computeMetadata/v1/',
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain('not allowed');
      });
    });

    describe('should reject URLs resolving to private IPs', () => {
      it('should reject URL resolving to 127.0.0.1', async () => {
        mockDnsSuccess(['127.0.0.1']);
        const result = await validateWebhookUrl(
          'https://evil.example.com/webhook',
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain('reserved/private');
      });

      it('should reject URL resolving to 10.0.0.1', async () => {
        mockDnsSuccess(['10.0.0.1']);
        const result = await validateWebhookUrl(
          'https://evil.example.com/webhook',
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain('reserved/private');
      });

      it('should reject URL resolving to 169.254.169.254', async () => {
        mockDnsSuccess(['169.254.169.254']);
        const result = await validateWebhookUrl(
          'https://evil.example.com/webhook',
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain('reserved/private');
      });

      it('should reject URL resolving to 192.168.1.1', async () => {
        mockDnsSuccess(['192.168.1.1']);
        const result = await validateWebhookUrl(
          'https://evil.example.com/webhook',
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain('reserved/private');
      });

      it('should reject URL resolving to 172.16.0.1', async () => {
        mockDnsSuccess(['172.16.0.1']);
        const result = await validateWebhookUrl(
          'https://evil.example.com/webhook',
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain('reserved/private');
      });
    });

    describe('should reject invalid URLs', () => {
      it('should reject empty string', async () => {
        const result = await validateWebhookUrl('');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid URL');
      });

      it('should reject malformed URLs', async () => {
        const result = await validateWebhookUrl('not-a-url');
        expect(result.valid).toBe(false);
      });
    });

    describe('should accept valid HTTPS URLs', () => {
      it('should accept valid public HTTPS URLs', async () => {
        mockDnsSuccess(['93.184.216.34']);
        const result = await validateWebhookUrl(
          'https://api.example.com/webhooks',
        );
        expect(result.valid).toBe(true);
      });

      it('should accept HTTPS URLs with ports', async () => {
        mockDnsSuccess(['93.184.216.34']);
        const result = await validateWebhookUrl(
          'https://api.example.com:8443/webhooks',
        );
        expect(result.valid).toBe(true);
      });

      it('should accept HTTPS URLs with query parameters', async () => {
        mockDnsSuccess(['93.184.216.34']);
        const result = await validateWebhookUrl(
          'https://api.example.com/webhooks?token=abc123',
        );
        expect(result.valid).toBe(true);
      });

      it('should reject URL when DNS resolution fails', async () => {
        mockDnsError();
        const result = await validateWebhookUrl(
          'https://nonexistent.invalid/webhook',
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Unable to resolve');
      });
    });
  });

  describe('isPrivateHostSync', () => {
    it('should return true for localhost', () => {
      expect(isPrivateHostSync('localhost')).toBe(true);
    });

    it('should return true for 127.0.0.1', () => {
      expect(isPrivateHostSync('127.0.0.1')).toBe(true);
    });

    it('should return true for 10.0.0.1', () => {
      expect(isPrivateHostSync('10.0.0.1')).toBe(true);
    });

    it('should return true for 192.168.1.1', () => {
      expect(isPrivateHostSync('192.168.1.1')).toBe(true);
    });

    it('should return true for 172.16.0.1', () => {
      expect(isPrivateHostSync('172.16.0.1')).toBe(true);
    });

    it('should return true for 169.254.169.254', () => {
      expect(isPrivateHostSync('169.254.169.254')).toBe(true);
    });

    it('should return false for public IPs', () => {
      expect(isPrivateHostSync('8.8.8.8')).toBe(false);
    });

    it('should return false for valid public hostnames', () => {
      expect(isPrivateHostSync('example.com')).toBe(false);
    });
  });
});
