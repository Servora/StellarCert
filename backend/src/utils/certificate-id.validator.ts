/**
 * Certificate ID validation utilities.
 * Addresses issue #420: Certificate ID collision possible with user-provided IDs.
 *
 * Enforces ID format rules: prefix with issuer address, enforce length limits,
 * and reject empty or suspiciously long strings.
 */

const CERT_ID_MIN_LENGTH = 8;
const CERT_ID_MAX_LENGTH = 128;
const CERT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface CertIdValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates a raw certificate ID provided by the issuer.
 */
export function validateCertificateId(id: string): CertIdValidationResult {
  if (!id || id.trim().length === 0) {
    return { valid: false, reason: 'Certificate ID must not be empty.' };
  }

  if (id.length < CERT_ID_MIN_LENGTH) {
    return {
      valid: false,
      reason: `Certificate ID must be at least ${CERT_ID_MIN_LENGTH} characters.`,
    };
  }

  if (id.length > CERT_ID_MAX_LENGTH) {
    return {
      valid: false,
      reason: `Certificate ID must not exceed ${CERT_ID_MAX_LENGTH} characters.`,
    };
  }

  if (!CERT_ID_PATTERN.test(id)) {
    return {
      valid: false,
      reason:
        'Certificate ID may only contain alphanumeric characters, hyphens, and underscores.',
    };
  }

  return { valid: true };
}

/**
 * Builds a namespaced certificate ID by prefixing with the issuer's address.
 * This prevents cross-issuer collisions even when raw IDs are identical.
 */
export function buildNamespacedCertId(
  issuerAddress: string,
  rawId: string,
): string {
  const validation = validateCertificateId(rawId);
  if (!validation.valid) {
    throw new Error(`Invalid certificate ID: ${validation.reason}`);
  }
  // Truncate issuer address to first 10 chars for readability
  const prefix = issuerAddress
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 10)
    .toUpperCase();
  return `${prefix}_${rawId}`;
}
