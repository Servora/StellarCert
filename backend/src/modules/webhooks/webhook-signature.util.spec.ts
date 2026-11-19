import { truncateWebhookResponse, webhookSignatureHeader } from './webhook-signature.util';
import * as crypto from 'crypto';

describe('webhook signature util', () => {
  it('signs <timestamp>.<json payload> with HMAC-SHA256', () => {
    const payload = { a: 1 };
    const expected = crypto
      .createHmac('sha256', 'k')
      .update('1700000000.{"a":1}')
      .digest('hex');
    expect(webhookSignatureHeader('k', payload, 1700000000)).toBe(
      `t=1700000000,v1=${expected}`,
    );
  });

  it('truncates only bodies longer than 2 KiB', () => {
    expect(truncateWebhookResponse('abc')).toBe('abc');
    expect(truncateWebhookResponse('x'.repeat(2048))).toHaveLength(2048);
    expect(truncateWebhookResponse('x'.repeat(3000))).toHaveLength(2048);
    expect(truncateWebhookResponse(undefined)).toBeUndefined();
    expect(truncateWebhookResponse('')).toBe('');
  });
});
