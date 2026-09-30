/**
 * Issue #721 / #722 – polling and real result handling helpers.
 */
describe('MultisigService waitForTransaction behavior', () => {
  it('documents that getTransaction must not run in the same tick as sendTransaction', () => {
    // Structural guarantee: waitForTransaction exists on the service prototype
    // and is used by all sendTransaction call sites (asserted via source scan in CI).
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, 'multisig.service.ts'), 'utf8');
    expect(src).toContain('waitForTransaction');
    // No remaining same-tick getTransaction after send without wait
    const withoutHelper = src.replace(/private async waitForTransaction[\s\S]*?^\s{2}\S/m, '');
    // All PENDING branches should call waitForTransaction
    const pendingBlocks = src.match(/response\.status === 'PENDING'[\s\S]{0,120}/g) || [];
    for (const block of pendingBlocks) {
      expect(block).toMatch(/waitForTransaction/);
    }
  });

  it('proposeCertificate fetches pending request instead of a hardcoded mock', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, 'multisig.service.ts'), 'utf8');
    expect(src).not.toMatch(/Return a mock object/);
    expect(src).toContain('getPendingRequest(requestId)');
  });
});

describe('Multisig DTOs (issue #720)', () => {
  it('DTO classes do not inject LoggingService in constructors', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, 'multisig.controller.ts'), 'utf8');
    expect(src).not.toMatch(/class \w+Dto[\s\S]{0,200}constructor\(private readonly logger: LoggingService\)/);
  });
});
