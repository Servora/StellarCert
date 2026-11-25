import { warnIfSorobanUnconfigured } from './soroban-startup-warning';

describe('warnIfSorobanUnconfigured', () => {
  const makeLogger = () => ({ warn: jest.fn() });

  it('warns that integration is disabled when ENABLE_SOROBAN_INTEGRATION is unset', () => {
    const logger = makeLogger();

    warnIfSorobanUnconfigured(logger, {});

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('ENABLE_SOROBAN_INTEGRATION is not "true"'),
    );
  });

  it('warns that integration is disabled when ENABLE_SOROBAN_INTEGRATION is not "true"', () => {
    const logger = makeLogger();

    warnIfSorobanUnconfigured(logger, { ENABLE_SOROBAN_INTEGRATION: 'nope' });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('ENABLE_SOROBAN_INTEGRATION is not "true"'),
    );
  });

  it('accepts ENABLE_SOROBAN_INTEGRATION regardless of case or surrounding whitespace', () => {
    const logger = makeLogger();

    warnIfSorobanUnconfigured(logger, {
      ENABLE_SOROBAN_INTEGRATION: ' TRUE ',
      SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
      SOROBAN_ADMIN_SECRET: 'S...',
      CERTIFICATE_CONTRACT_ID: 'C...',
      MULTISIG_CONTRACT_ID: 'C...',
      CRL_CONTRACT_ID: 'C...',
    });

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns which variables are missing when integration is enabled but unconfigured', () => {
    const logger = makeLogger();

    warnIfSorobanUnconfigured(logger, { ENABLE_SOROBAN_INTEGRATION: 'true' });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'SOROBAN_RPC_URL, SOROBAN_ADMIN_SECRET, CERTIFICATE_CONTRACT_ID, MULTISIG_CONTRACT_ID, CRL_CONTRACT_ID',
      ),
    );
  });

  // Regression: SorobanService.initializeSoroban() treats SOROBAN_ADMIN_SECRET
  // as required right alongside SOROBAN_RPC_URL - omitting it here would let a
  // deployment pass this check while the real service still refuses to start.
  it('still warns when every variable except SOROBAN_ADMIN_SECRET is set', () => {
    const logger = makeLogger();

    warnIfSorobanUnconfigured(logger, {
      ENABLE_SOROBAN_INTEGRATION: 'true',
      SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
      CERTIFICATE_CONTRACT_ID: 'C...',
      MULTISIG_CONTRACT_ID: 'C...',
      CRL_CONTRACT_ID: 'C...',
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('SOROBAN_ADMIN_SECRET'),
    );
  });

  it('treats a blank or whitespace-only value the same as missing', () => {
    const logger = makeLogger();

    warnIfSorobanUnconfigured(logger, {
      ENABLE_SOROBAN_INTEGRATION: 'true',
      SOROBAN_RPC_URL: '   ',
      SOROBAN_ADMIN_SECRET: 'S...',
      CERTIFICATE_CONTRACT_ID: 'C...',
      MULTISIG_CONTRACT_ID: 'C...',
      CRL_CONTRACT_ID: 'C...',
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('SOROBAN_RPC_URL'),
    );
  });

  it('warns nothing when fully configured', () => {
    const logger = makeLogger();

    warnIfSorobanUnconfigured(logger, {
      ENABLE_SOROBAN_INTEGRATION: 'true',
      SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
      SOROBAN_ADMIN_SECRET: 'S...',
      CERTIFICATE_CONTRACT_ID: 'C...',
      MULTISIG_CONTRACT_ID: 'C...',
      CRL_CONTRACT_ID: 'C...',
    });

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
