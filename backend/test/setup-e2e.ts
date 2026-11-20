// See src/common/rate-limiting/rate-limit-test-switch.ts.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_DISABLED = 'true';

// Cross-stack smoke tests (Playwright, run against docker compose) use the
// real backend, so the e2e setup must not leak test-only env into them.
if (process.env.SMOKE_E2E === 'true') {
  process.env.NODE_ENV = 'development';
}
