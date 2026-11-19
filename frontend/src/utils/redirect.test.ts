import { describe, expect, it } from "vitest";
import { getSafeRedirectPath } from "./redirect";

describe("getSafeRedirectPath", () => {
  it("returns the fallback for a missing value", () => {
    expect(getSafeRedirectPath(null)).toBe("/");
    expect(getSafeRedirectPath(undefined)).toBe("/");
    expect(getSafeRedirectPath("")).toBe("/");
  });

  it("allows allowlisted internal paths, keeping query and hash", () => {
    expect(getSafeRedirectPath("/wallet")).toBe("/wallet");
    expect(getSafeRedirectPath("/admin/users")).toBe("/admin/users");
    expect(getSafeRedirectPath("/verify?serial=ABC-1")).toBe(
      "/verify?serial=ABC-1",
    );
    expect(getSafeRedirectPath("/certificates#top")).toBe("/certificates#top");
    expect(getSafeRedirectPath("/profile/")).toBe("/profile");
  });

  it.each([
    "https://evil.com",
    "http://evil.com/wallet",
    "//evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "javascript:alert(1)",
    "/\t/evil.com",
    "/\n/evil.com",
    "/%0a/evil.com",
    "/wallet/../../evil.com",
    "wallet",
  ])("rejects external or malformed target %j", (target) => {
    expect(getSafeRedirectPath(target)).toBe("/");
  });

  it("rejects internal paths that are not on the allowlist", () => {
    expect(getSafeRedirectPath("/login")).toBe("/");
    expect(getSafeRedirectPath("/not-a-route")).toBe("/");
    expect(getSafeRedirectPath("/wallet/../login")).toBe("/");
  });

  it("uses a caller-supplied fallback", () => {
    expect(getSafeRedirectPath("//evil.com", "/dashboard")).toBe("/dashboard");
  });
});

describe("getSafeRedirectPath deep links", () => {
  it("keeps a sub-path of an allowed route, with its query", () => {
    expect(getSafeRedirectPath("/certificates/abc-123?tab=files")).toBe(
      "/certificates/abc-123?tab=files",
    );
  });

  it("does not treat '/' as a prefix for everything", () => {
    expect(getSafeRedirectPath("/login")).toBe("/");
    expect(getSafeRedirectPath("/wallets-evil")).toBe("/");
  });
});
