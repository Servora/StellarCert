/**
 * Lets the e2e suite opt out of request rate limiting.
 *
 * The suite drives many registrations and logins from one address, far more
 * than the 5-per-minute auth limit allows, so later requests were throttled
 * and the tests that depended on them failed for reasons unrelated to what
 * they test. Both conditions are required, so this can never take effect in a
 * deployed environment by setting a single variable. Read from process.env
 * directly: environment.config only forwards an allow-list of variables.
 */
export function rateLimitsDisabledForTests(): boolean {
  return (
    process.env.NODE_ENV === 'test' &&
    process.env.RATE_LIMIT_DISABLED === 'true'
  );
}
