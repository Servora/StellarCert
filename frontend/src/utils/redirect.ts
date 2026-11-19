const DEFAULT_SAFE_PATH = "/";

/**
 * Internal paths a post-login redirect may land on. These mirror the routes
 * declared in `App.tsx`; anything not listed here (including `/login` itself,
 * which would loop) falls back to the default.
 */
export const ALLOWED_REDIRECT_PATHS: readonly string[] = [
  "/",
  "/dashboard",
  "/verify",
  "/verify-email",
  "/reset-password",
  "/wallet",
  "/issue",
  "/revoke",
  "/certificates",
  "/admin/users",
  "/admin/audit",
  "/profile",
  "/preferences",
  "/security",
];

/**
 * Whether a normalized pathname is an allowed route or a sub-path of one
 * (e.g. `/certificates/abc-123`), so deep links survive the login redirect.
 * "/" only matches itself, otherwise it would admit every path.
 */
const isAllowedPath = (pathname: string): boolean =>
  ALLOWED_REDIRECT_PATHS.some(
    (allowed) =>
      pathname === allowed ||
      (allowed !== "/" && pathname.startsWith(`${allowed}/`)),
  );

// Placeholder origin used only to parse the candidate. It never leaves this
// module: the result is accepted only if parsing kept it on this origin.
const PARSE_ORIGIN = "http://stellarcert.invalid";

/**
 * Validates a post-login redirect target against an allowlist of internal,
 * same-origin paths. Query-string params like `returnUrl` are attacker
 * controlled, so anything that isn't a plain relative path to a known route
 * (e.g. an absolute URL, a protocol-relative `//host` URL, a backslash variant
 * a browser may reinterpret as protocol-relative, or a path smuggling control
 * characters that browsers strip before parsing) is rejected in favor of the
 * fallback.
 */
export const getSafeRedirectPath = (
  candidate: string | null | undefined,
  fallback: string = DEFAULT_SAFE_PATH,
): string => {
  if (!candidate) return fallback;

  // Browsers drop tab/newline characters from URLs, so `/\t/evil.com` would
  // become `//evil.com`. Reject whitespace and control characters outright.
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(candidate)) return fallback;

  // Must start with a single '/' — rejects absolute URLs (https://evil.com),
  // scheme-relative URLs (//evil.com), and backslash variants (/\evil.com,
  // \\evil.com) that some browsers normalize into protocol-relative URLs.
  if (!/^\/(?!\/|\\)/.test(candidate)) return fallback;

  let parsed: URL;
  try {
    parsed = new URL(candidate, PARSE_ORIGIN);
  } catch {
    return fallback;
  }
  if (parsed.origin !== PARSE_ORIGIN) return fallback;

  // Compare the normalized pathname, so dot segments (`/wallet/../evil`) and
  // trailing slashes cannot sneak past the allowlist.
  const pathname =
    parsed.pathname.length > 1
      ? parsed.pathname.replace(/\/+$/, "")
      : parsed.pathname;
  if (!isAllowedPath(pathname)) return fallback;

  return `${pathname}${parsed.search}${parsed.hash}`;
};
