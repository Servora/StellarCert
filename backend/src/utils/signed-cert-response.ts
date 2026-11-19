/**
 * Signed certificate response builder.
 * Addresses issue #422: No Soroban auth for `is_valid` and read-only functions.
 *
 * Read-only functions like get_certificate() and is_valid() return data that
 * third-party verifiers cannot independently authenticate. This module wraps
 * responses in a signed envelope so the caller can prove the data came from
 * a trusted source without requiring on-chain auth for every read.
 */

import { createHmac } from 'crypto';

export interface CertificateData {
  certId: string;
  issuedTo: string;
  issuedBy: string;
  isValid: boolean;
  expiresAt: number;
}

export interface SignedCertificateResponse {
  data: CertificateData;
  timestamp: number;
  signature: string;
}

/**
 * Signs a certificate read response with an HMAC so third-party verifiers
 * can confirm the response was produced by a trusted backend.
 *
 * @param data      The certificate data returned by the read-only function.
 * @param secretKey The server-side signing secret (never exposed to clients).
 */
export function signCertificateResponse(
  data: CertificateData,
  secretKey: string,
): SignedCertificateResponse {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ data, timestamp });
  const signature = createHmac('sha256', secretKey)
    .update(payload)
    .digest('hex');
  return { data, timestamp, signature };
}

/**
 * Verifies a signed certificate response.
 * Returns true only if the signature is valid and the response is not stale.
 *
 * @param response  The signed response to verify.
 * @param secretKey The same secret used when signing.
 * @param maxAgeSeconds Maximum acceptable age of the response (default 5 min).
 */
export function verifyCertificateResponse(
  response: SignedCertificateResponse,
  secretKey: string,
  maxAgeSeconds = 300,
): boolean {
  const payload = JSON.stringify({
    data: response.data,
    timestamp: response.timestamp,
  });
  const expected = createHmac('sha256', secretKey)
    .update(payload)
    .digest('hex');
  const now = Math.floor(Date.now() / 1000);
  const fresh = now - response.timestamp <= maxAgeSeconds;
  return fresh && response.signature === expected;
}
