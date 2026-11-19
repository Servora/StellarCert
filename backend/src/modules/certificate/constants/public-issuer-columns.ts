/**
 * Issuer columns that are safe to return alongside a certificate. Joining the
 * whole `User` row leaked secrets such as `emailVerificationToken` and the
 * `refreshToken` hash (#1113), so certificate queries select only these.
 */
export const PUBLIC_ISSUER_COLUMNS = [
  'issuer.id',
  'issuer.firstName',
  'issuer.lastName',
  'issuer.stellarPublicKey',
];
