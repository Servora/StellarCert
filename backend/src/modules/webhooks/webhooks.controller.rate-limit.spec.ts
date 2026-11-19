import 'reflect-metadata';
import {
  RATE_LIMIT_OPTIONS_KEY,
  RateLimitOptions,
} from '../security/decorators/rate-limit.decorator';
import { WebhooksController, WEBHOOK_TEST_RATE_LIMIT } from './webhooks.controller';

const optionsFor = (handler: unknown): RateLimitOptions | undefined =>
  Reflect.getMetadata(RATE_LIMIT_OPTIONS_KEY, handler as object);

describe('WebhooksController rate limits', () => {
  it('limits both test endpoints per issuer', () => {
    expect(optionsFor(WebhooksController.prototype.test)).toEqual(WEBHOOK_TEST_RATE_LIMIT);
    expect(optionsFor(WebhooksController.prototype.testSync)).toEqual(WEBHOOK_TEST_RATE_LIMIT);
    expect(WEBHOOK_TEST_RATE_LIMIT).toEqual({ limit: 5, windowMs: 60_000, keyBy: 'user' });
  });

  it('does not add a limit to the ordinary endpoints', () => {
    expect(optionsFor(WebhooksController.prototype.create)).toBeUndefined();
    expect(optionsFor(WebhooksController.prototype.findAll)).toBeUndefined();
    expect(optionsFor(WebhooksController.prototype.getLogs)).toBeUndefined();
  });
});
