import * as crypto from 'crypto';

/**
 * HMAC-SHA256 signature header for a webhook delivery.
 *
 * Format: `t=<unix seconds>,v1=<hex>`, where the signature is computed over
 * `<timestamp>.<json payload>` with the subscription's secret. Shared by the
 * queued delivery (processor) and the synchronous test delivery so both sign
 * identically.
 */
export function webhookSignatureHeader(
  secret: string,
  payload: unknown,
  timestamp: number,
): string {
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${JSON.stringify(payload)}`)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

/** Cap stored/returned response bodies at 2 KiB. */
export function truncateWebhookResponse(
  body: string | undefined | null,
): string | undefined {
  if (!body) return body ?? undefined;
  return body.length > 2048 ? body.substring(0, 2048) : body;
}
