export interface SorobanLogger {
  warn: (message: string) => void;
}

// Matches SorobanService.initializeSoroban()'s own required set exactly
// (rpcUrl, network, adminSecret) plus the contract ids it needs to resolve
// calls - STELLAR_NETWORK is covered by existing bootstrap validation
// elsewhere, so it isn't repeated here.
const REQUIRED_SOROBAN_VARS = [
  'SOROBAN_RPC_URL',
  'SOROBAN_ADMIN_SECRET',
  'CERTIFICATE_CONTRACT_ID',
  'MULTISIG_CONTRACT_ID',
  'CRL_CONTRACT_ID',
] as const;

export function warnIfSorobanUnconfigured(
  logger: SorobanLogger = console,
  env: Record<string, string | undefined> = process.env,
): void {
  const enabled =
    String(env.ENABLE_SOROBAN_INTEGRATION ?? '')
      .trim()
      .toLowerCase() === 'true';

  if (!enabled) {
    logger.warn(
      '[Soroban] ENABLE_SOROBAN_INTEGRATION is not "true" — on-chain contract integration is disabled and certificates will NOT sync with deployed Soroban contracts.',
    );
    return;
  }

  const missing = REQUIRED_SOROBAN_VARS.filter(
    (key) => !env[key] || !String(env[key]).trim(),
  );

  if (missing.length > 0) {
    logger.warn(
      `[Soroban] ENABLE_SOROBAN_INTEGRATION is enabled, but missing required variables (${missing.join(', ')}) — certificates will NOT sync reliably with deployed contracts.`,
    );
  }
}
