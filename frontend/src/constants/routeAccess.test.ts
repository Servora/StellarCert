import { describe, expect, it } from 'vitest';
import { UserRole } from '../api/types';
import { WALLET_ALLOWED_ROLES, canAccessWallet } from './routeAccess';

describe('canAccessWallet', () => {
  it.each([UserRole.RECIPIENT, UserRole.VERIFIER, UserRole.ISSUER, UserRole.ADMIN])(
    'admits %s',
    (role) => {
      expect(canAccessWallet(role)).toBe(true);
    },
  );

  // USER is the role assigned at registration, and the /wallet route rejects
  // it — the nav link must not offer a page that bounces straight back to `/`.
  it.each([UserRole.USER, UserRole.AUDITOR])('rejects %s', (role) => {
    expect(canAccessWallet(role)).toBe(false);
  });

  it('rejects a missing role', () => {
    expect(canAccessWallet(undefined)).toBe(false);
    expect(canAccessWallet(null)).toBe(false);
    expect(canAccessWallet('')).toBe(false);
  });

  it('rejects an unrecognised role', () => {
    expect(canAccessWallet('superuser')).toBe(false);
  });

  it('accepts the role as the plain string the API returns', () => {
    expect(canAccessWallet('recipient')).toBe(true);
    expect(canAccessWallet('user')).toBe(false);
  });
});

describe('WALLET_ALLOWED_ROLES', () => {
  it('lists exactly the roles the route guards with', () => {
    expect([...WALLET_ALLOWED_ROLES]).toEqual([
      UserRole.RECIPIENT,
      UserRole.VERIFIER,
      UserRole.ISSUER,
      UserRole.ADMIN,
    ]);
  });

  it('excludes the roles the route rejects', () => {
    expect(WALLET_ALLOWED_ROLES).not.toContain(UserRole.USER);
    expect(WALLET_ALLOWED_ROLES).not.toContain(UserRole.AUDITOR);
  });
});
