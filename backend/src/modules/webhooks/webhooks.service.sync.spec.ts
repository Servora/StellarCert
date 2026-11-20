import axios from 'axios';
import { WebhooksService } from './webhooks.service';
import { webhookSignatureHeader } from './webhook-signature.util';
import { validateWebhookUrl } from '../../common/utils/ssrf.utils';

jest.mock('axios');
jest.mock('../../common/utils/ssrf.utils', () => ({
  validateWebhookUrl: jest.fn(),
}));

const post = axios.post as jest.Mock;
const validate = validateWebhookUrl as jest.Mock;

describe('WebhooksService.testDeliverySync', () => {
  const subscription = {
    id: 'sub-1',
    issuerId: 'issuer-1',
    url: 'https://example.com/hook',
    secret: 's3cret',
  };
  const subscriptions = { findOne: jest.fn() };
  const logs = { save: jest.fn() };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  let service: WebhooksService;

  beforeEach(() => {
    jest.resetAllMocks();
    subscriptions.findOne.mockResolvedValue(subscription);
    logs.save.mockImplementation((row) =>
      Promise.resolve({ id: 'log-1', ...row }),
    );
    validate.mockResolvedValue({ valid: true });
    service = new WebhooksService(
      subscriptions as never,
      logs as never,
      { add: jest.fn() } as never,
      logger as never,
    );
  });

  it('delivers the test event synchronously and returns the endpoint outcome', async () => {
    post.mockResolvedValue({ status: 200, data: { ok: true } });

    const result = await service.testDeliverySync('sub-1', 'issuer-1');

    expect(result).toMatchObject({
      success: true,
      statusCode: 200,
      response: '{"ok":true}',
      logId: 'log-1',
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(logs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub-1',
        event: 'webhook.test',
        statusCode: 200,
        isSuccess: true,
        duration: expect.any(Number),
      }),
    );
  });

  it('signs the request exactly like a queued delivery', async () => {
    post.mockResolvedValue({ status: 204, data: '' });

    await service.testDeliverySync('sub-1', 'issuer-1');

    const [url, payload, config] = post.mock.calls[0];
    expect(url).toBe('https://example.com/hook');
    expect(payload).toMatchObject({
      event: 'webhook.test',
      data: { test: true },
    });
    const header = config.headers['X-StellarCert-Signature'] as string;
    const timestamp = Number(/^t=(\d+),v1=/.exec(header)![1]);
    expect(header).toBe(webhookSignatureHeader('s3cret', payload, timestamp));
    expect(config.headers['X-StellarCert-Event']).toBe('webhook.test');
    expect(config.maxRedirects).toBe(0);
    expect(config.timeout).toBe(5000);
  });

  it('reports an endpoint error status instead of throwing', async () => {
    post.mockRejectedValue({
      message: 'Request failed with status code 401',
      response: { status: 401, data: { error: 'bad signature' } },
    });

    const result = await service.testDeliverySync('sub-1', 'issuer-1');

    expect(result).toMatchObject({
      success: false,
      statusCode: 401,
      error: 'Endpoint responded with HTTP 401',
      response: '{"error":"bad signature"}',
    });
    expect(logs.save).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401, isSuccess: false }),
    );
  });

  it('reports a network failure (no response) with status 0', async () => {
    post.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const result = await service.testDeliverySync('sub-1', 'issuer-1');

    expect(result).toMatchObject({
      success: false,
      statusCode: 0,
      error: 'connect ECONNREFUSED',
    });
  });

  it('never contacts an endpoint that fails SSRF validation', async () => {
    validate.mockResolvedValue({ valid: false, error: 'private address' });

    const result = await service.testDeliverySync('sub-1', 'issuer-1');

    expect(post).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      statusCode: 0,
      error: 'Webhook URL is not safe: private address',
    });
    expect(logs.save).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 0, isSuccess: false }),
    );
  });

  it('truncates long responses to 2 KiB', async () => {
    post.mockResolvedValue({ status: 200, data: 'x'.repeat(5000) });

    const result = await service.testDeliverySync('sub-1', 'issuer-1');

    expect(result.response).toHaveLength(2048);
  });

  it('still returns the outcome when the log row cannot be written', async () => {
    post.mockResolvedValue({ status: 200, data: 'ok' });
    logs.save.mockRejectedValue(new Error('db down'));

    const result = await service.testDeliverySync('sub-1', 'issuer-1');

    expect(result.success).toBe(true);
    expect(result.logId).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("is limited to the issuer's own subscriptions", async () => {
    subscriptions.findOne.mockResolvedValue(null);

    await expect(
      service.testDeliverySync('sub-1', 'someone-else'),
    ).rejects.toThrow('Webhook subscription not found');
    expect(post).not.toHaveBeenCalled();
  });
});
