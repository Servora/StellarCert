import { describe, expect, it } from "vitest";
import { UserRole } from "../api/types";
import { WALLET_ALLOWED_ROLES, canAccessWallet } from "./routeAccess";

describe("canAccessWallet", () => {
  it.each([
    UserRole.USER,
    UserRole.RECIPIENT,
    UserRole.VERIFIER,
    UserRole.ISSUER,
    UserRole.ADMIN,
  ])("admits %s", (role) => {
    expect(canAccessWallet(role)).toBe(true);
  });

  // AUDITOR has no certificates of its own and no dedicated wallet view.
  it("rejects AUDITOR", () => {
    expect(canAccessWallet(UserRole.AUDITOR)).toBe(false);
  });

  it("rejects a missing role", () => {
    expect(canAccessWallet(undefined)).toBe(false);
    expect(canAccessWallet(null)).toBe(false);
    expect(canAccessWallet("")).toBe(false);
  });

  it("rejects an unrecognised role", () => {
    expect(canAccessWallet("superuser")).toBe(false);
  });

  it("accepts the role as the plain string the API returns", () => {
    expect(canAccessWallet("recipient")).toBe(true);
    expect(canAccessWallet("user")).toBe(true);
  });
});

describe("WALLET_ALLOWED_ROLES", () => {
  it("lists exactly the roles the route guards with", () => {
    expect([...WALLET_ALLOWED_ROLES]).toEqual([
      UserRole.USER,
      UserRole.RECIPIENT,
      UserRole.VERIFIER,
      UserRole.ISSUER,
      UserRole.ADMIN,
    ]);
  });

  it("excludes the roles the route rejects", () => {
    expect(WALLET_ALLOWED_ROLES).not.toContain(UserRole.AUDITOR);
  });
});
