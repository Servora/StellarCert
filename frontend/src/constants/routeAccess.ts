import { UserRole } from '../api/types';

/**
 * Roles the `/wallet` route admits.
 *
 * This lives here rather than inline in `App.tsx` so the route guard and the
 * navigation that links to it read the same list. They were previously written
 * out separately and drifted: the header offered a Wallet link to every signed
 * in user, while the route rejected `USER` — the role assigned at registration
 * — and `AUDITOR`, bouncing them back to `/` (#789).
 */
export const WALLET_ALLOWED_ROLES: readonly UserRole[] = [
  UserRole.RECIPIENT,
  UserRole.VERIFIER,
  UserRole.ISSUER,
  UserRole.ADMIN,
];

/**
 * Whether `role` may open the wallet.
 *
 * Takes the role as it appears on the user record — a plain string from the
 * API — rather than requiring the caller to have narrowed it to `UserRole`
 * first, and answers `false` for a missing or unrecognised role.
 */
export function canAccessWallet(role: UserRole | string | undefined | null): boolean {
  if (!role) return false;

  return WALLET_ALLOWED_ROLES.includes(role as UserRole);
}
