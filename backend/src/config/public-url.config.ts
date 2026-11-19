/**
 * Single source of truth for the public URL of the web app.
 *
 * Every link that leaves the backend — certificate QR codes, PDFs, and the
 * emails we send — is built from `getAppBaseUrl()`, so a deployment cannot end
 * up with emails pointing at one host and QR codes at another (#1242).
 *
 * `FRONTEND_URL` is the canonical variable. `APP_URL` remains a deprecated
 * alias so existing deployments keep working, and the first `ALLOWED_ORIGINS`
 * entry is the final fallback (the auth and password-reset links behaved that
 * way before this module existed).
 */
export const DEFAULT_APP_URL = 'http://localhost:5173';

function firstAllowedOrigin(value?: string): string | undefined {
  const [first] = (value ?? '').split(',');
  return first?.trim() || undefined;
}

export function getAppBaseUrl(): string {
  const baseUrl =
    process.env.FRONTEND_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    firstAllowedOrigin(process.env.ALLOWED_ORIGINS) ||
    DEFAULT_APP_URL;

  // A trailing slash here would produce `//verify`, so strip it once instead
  // of at every call site.
  return baseUrl.replace(/\/+$/, '');
}

/**
 * Public verification link.
 *
 * The frontend exposes `/verify` and reads the serial from `?serial=`. It has
 * no `/verify/:code` page, so emitting a path segment sent every scanned QR
 * code and every printed certificate link to the 404 route (#1242).
 */
export function buildVerificationUrl(verificationCode: string): string {
  const code = encodeURIComponent(verificationCode);
  return `${getAppBaseUrl()}/verify?serial=${code}`;
}

/** Token link used by the email-confirmation and password-reset flows. */
export function buildAppLink(path: string, token: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const query = `token=${encodeURIComponent(token)}`;
  return `${getAppBaseUrl()}${normalizedPath}?${query}`;
}
