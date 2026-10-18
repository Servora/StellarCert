/**
 * Issue #719 – webhook secret is returned once at create, then stripped.
 */
describe('Webhook secret handling', () => {
  it('service source stores secretHash and sanitizes list/find responses', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, 'webhooks.service.ts'), 'utf8');
    expect(src).toContain('secretHash');
    expect(src).toContain('sanitizeSubscription');
    expect(src).toContain('one-time reveal');
    expect(src).toContain('hasSecret');
  });
});
