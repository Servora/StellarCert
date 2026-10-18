# StellarCert Issue Tracker

---

## Backend

---

**Title:** Webhook `createSubscription` returns the HMAC secret in the response body
**Labels:** `bug` `security` `backend`
**Body:** The full webhook subscription entity — including the raw HMAC `secret` field — is returned from `createSubscription`. The secret should be displayed once at creation and then stored hashed server-side. Subsequent reads of the subscription should never return the secret, only an indicator that one is set.

---

**Title:** Multisig DTO constructors inject `LoggingService` as a property — broken instantiation
**Labels:** `bug` `backend`
**Body:** In `multisig.controller.ts`, several DTOs declare `constructor(private readonly logger: LoggingService)`. NestJS's `class-transformer` instantiates DTOs with `new Dto(plainBody)` — it does not use the DI container. The first (and only) constructor argument becomes `logger`, which receives the raw body object instead of a logger instance. Every multisig DTO is broken on instantiation.

---

**Title:** Multisig service calls `getTransaction` immediately after `sendTransaction` without polling
**Labels:** `bug` `backend`
**Body:** In `multisig.service.ts`, every Soroban transaction flow calls `getTransaction` in the same tick as `sendTransaction`. The transaction is almost always still `PENDING` or `NOT_FOUND` at the RPC node at that point. There is no polling loop or retry mechanism. The service always reads an unfinalized result and the returned data is stale or empty.

---

**Title:** `proposeCertificate` and `approveRequest` return hardcoded mock objects
**Labels:** `bug` `backend`
**Body:** `multisig.service.ts` contains comments that say "mock object" and "mock success result". These methods build fabricated response objects instead of parsing actual contract return values. Any client relying on these responses receives made-up data.

---

**Title:** All multisig controller handlers typed `Promise<any>` — no compile-time shape safety
**Labels:** `tech-debt` `backend`
**Body:** Every handler in `multisig.controller.ts` returns `Promise<any>`. Breaking changes in service return types will not be caught by the TypeScript compiler. Define and use proper response DTO interfaces for all multisig endpoints.

---

**Title:** `listIssuers` returns all rows with no pagination — unbounded memory usage
**Labels:** `enhancement` `backend`
**Body:** `GET /issuers` calls an unbounded `findAll()` query. In production with many issuers this loads the entire table into memory and returns a potentially multi-MB JSON response. Add `page` and `limit` query parameters and return a paginated response matching the rest of the API.

---

**Title:** `incrementCertificateCount` never called from certificate issuance flow
**Labels:** `bug` `backend`
**Body:** The issuer certificate counter in the issuers table is never incremented when a certificate is issued. Issuer stats displayed in the UI always show zero or stale counts because the increment hook was never wired from `CertificateService.issue()` to `IssuersService.incrementCertificateCount()`.

---

**Title:** IP rate-limit guard stores state in process-local `Map` — ineffective in multi-instance deployments
**Labels:** `bug` `backend`
**Body:** `ip-rate-limit.guard.ts` uses an in-memory `Map` to track request counts. In any multi-replica deployment (Docker Swarm, Kubernetes) each pod maintains its own counter, and an attacker can trivially bypass the limit by round-robining across instances. All state is also lost on process restart. Rate-limit state must be stored in Redis or another shared store.

---

**Title:** IP rate-limit guard trusts `X-Forwarded-For` without sanitization — trivial bypass
**Labels:** `bug` `security` `backend`
**Body:** The `getClientIp` helper reads `X-Forwarded-For` and `X-Real-IP` headers without any validation or sanitization. An attacker can set these headers to an arbitrary IP address string and bypass per-IP rate limiting entirely. Only trust these headers when the request comes from a known trusted proxy.

---

**Title:** Pre-signed S3 profile picture URL expires after 1 hour — broken images app-wide
**Labels:** `bug` `backend`
**Body:** `StorageService.uploadFile()` generates a pre-signed URL with a 1-hour TTL and saves it to `user.profilePicture`. Every profile picture across the app returns HTTP 403 one hour after upload. The database should store the S3 object key, not the pre-signed URL. URLs should be generated on-demand per request or the bucket should use a public read policy.

---

**Title:** `StorageService` crashes startup when S3 config is absent and `STORAGE_REQUIRED` is not set
**Labels:** `bug` `backend`
**Body:** If `STORAGE_REQUIRED` is not explicitly set to `false` in `.env`, the `StorageService` throws a fatal error during `onModuleInit()` and prevents the app from starting. The default behavior should be a non-fatal warning in development. Add `STORAGE_REQUIRED=false` to `.env.example` and make startup non-fatal when the flag is absent.

---

**Title:** Analytics service only counts three roles — RECIPIENT, VERIFIER, AUDITOR omitted
**Labels:** `bug` `backend`
**Body:** `admin-analytics.service.ts` `getUsersByRole` only queries for `USER`, `ISSUER`, and `ADMIN`. The additional roles defined in `UserRole` are silently omitted from role distribution charts. Refactor to dynamically query all enum values.

---

**Title:** `ForgotPasswordDto.email` has no `@IsEmail()` validator
**Labels:** `bug` `backend`
**Body:** The email field in `ForgotPasswordDto` (in `change-password.dto.ts`) is decorated with only `@IsString()` and `@IsNotEmpty()`. Any non-empty string passes validation and is handed to the email queue, causing silent delivery failures and potentially leaking the password-reset flow to non-email inputs.

---

**Title:** On-chain certificate issuance failure leaves orphaned database record
**Labels:** `bug` `backend` `stellar`
**Body:** In `CertificateService`, the database record is committed before the Soroban on-chain call. If the on-chain call fails the error is re-thrown but the DB record persists without a `stellarTransactionHash`. There is no retry mechanism or reconciliation job. Add a background job or expose a `/certificates/:id/sync-chain` endpoint so issuers can re-attempt on-chain issuance for orphaned records.

---

---

## Frontend

---

**Title:** `IssuerProfile.tsx` swallows all data-load and update errors — blank panels silently
**Labels:** `bug` `frontend`
**Body:** Profile load, stats load, activity load, and profile update errors are all caught and logged to `console.error` with no user-visible feedback. Blank panels display with no indication of failure, giving users no path to retry or understand what went wrong.

---

**Title:** `IssueCertificate.tsx` date validation uses local timezone, backend validates against UTC
**Labels:** `bug` `frontend`
**Body:** Client-side validation compares `issueDate > today` using `new Date()` in the local timezone. The backend validates against UTC. A certificate issued at 11 PM UTC-5 passes client validation but may fail server validation, surfacing a confusing validation error to the user.

---

**Title:** `User` type inconsistency — `'firstName' in user` guard suggests multiple conflicting type shapes
**Labels:** `tech-debt` `frontend`
**Body:** `IssueCertificate.tsx` uses `'firstName' in user` to conditionally access the field, indicating that the `User` type used in that context may not reliably have `firstName`. Multiple diverging `User` interfaces likely exist in the codebase and are used interchangeably.

---

**Title:** No loading skeleton shown while QR codes are fetched per certificate in wallet
**Labels:** `enhancement` `frontend`
**Body:** `CertificateWallet.tsx` fetches QR codes sequentially in a `useEffect` loop. While each request is in flight, image placeholders display as blank rectangles with no spinner or skeleton. Add a per-card loading state that shows a skeleton until the QR code resolves.

---

**Title:** Dashboard `IssuanceChart` is hand-rolled SVG with no tooltip or accessibility
**Labels:** `enhancement` `frontend`
**Body:** The `IssuanceChart` in `Dashboard.tsx` is custom SVG with no hover tooltip, no accessible axis labels beyond a single `aria-label`, and no fallback for screen readers. Bar labels are truncated when many data points exist. Consider using Recharts (already in many React stacks) or add `<title>`, `role="img"`, and interactive tooltips at minimum.

---

**Title:** `USE_DUMMY_DATA` is a runtime flag — dummy data branches cannot be tree-shaken from production bundle
**Labels:** `tech-debt` `frontend`
**Body:** `VITE_USE_DUMMY_DATA` is read at runtime from `import.meta.env` but evaluated into a `const` that is checked in regular `if` branches rather than `if (import.meta.env.VITE_USE_DUMMY_DATA)` which Vite can statically analyze. The dummy data objects (large arrays of hardcoded certificates, users, templates) remain in the production bundle, adding dead weight and exposing internal data structures to anyone inspecting the bundle.

---

**Title:** Two separate dashboard stats APIs with different endpoints — only one can be correct
**Labels:** `tech-debt` `frontend`
**Body:** Both `analyticsApi.getDashboardSummary` (calls `/admin/analytics`) and `dashboardApi.getStats` (calls `/admin/analytics/dashboard`) exist in `endpoints.ts` and fetch statistics. It is unclear which components should use which, and if the backend route changes only one caller is updated. Consolidate to a single API function with a single correct endpoint.

---

**Title:** `CertificateWallet` shows issuer-owned action buttons to `VERIFIER` role users
**Labels:** `bug` `frontend`
**Body:** `ProtectedRoute` allows `VERIFIER` to access `/wallet`. The wallet renders download, transfer, and revoke buttons without checking whether the logged-in user actually owns the displayed certificates or has the appropriate role. A verifier can attempt actions the API will reject. Action buttons should be conditionally rendered based on `user.role` and certificate ownership.

---

---

## Stellar Contracts

---

**Title:** `crl.rs` uses 0-indexed pagination while `lib.rs` uses 1-indexed — off-by-one for API consumers
**Labels:** `bug` `contract`
**Body:** Pagination in `crl.rs` is 0-indexed (page 0 = first page). In `lib.rs`, pagination is 1-indexed with a `page.saturating_sub(1)` offset. A client that correctly uses 1-indexed pagination for certificates will skip the first page of CRL results. Unify pagination to 1-indexed across all contract functions.

**Status: RESOLVED** — `get_revoked_certificates` now uses the same 1-indexed convention as `lib.rs` (`page.saturating_sub(1).saturating_mul(limit)`, page 0 normalized to the first page) and enforces a `MAX_PAGE_SIZE` of 100 matching the certificate listings. See `crl_test.rs::test_get_revoked_certificates_pagination`.

---

**Title:** `crl.rs` `revoke_certificate` emits no event — backend cannot detect CRL changes
**Labels:** `enhancement` `contract`
**Body:** `crl.rs` `revoke_certificate` stores the revocation but emits no contract event. The backend webhook system and off-chain indexers have no on-chain signal to trigger certificate status updates. Add and emit a `CRLRevocationAddedEvent`.

---

**Title:** CRL and main contract revocations are not synchronized — a certificate can be revoked in one but not the other
**Labels:** `bug` `contract`
**Body:** `revoke_certificate` on `CertificateContract` updates certificate status in the main contract but does NOT call or notify the `CRLContract`. The CRL `revoke_certificate` must be called separately by the issuer. A certificate can be revoked in the main contract but still pass CRL checks, or be on the CRL but still show `Active` in the main contract. Either make revocation atomic via a cross-contract call or enforce both are always called together in tooling.

---

**Title:** `admin_multisig.rs` `cancel_proposal` records status as `Rejected` instead of `Cancelled`
**Labels:** `bug` `contract`
**Body:** `admin_multisig.rs` line ~229 sets `AdminProposalStatus::Rejected` when a proposal is cancelled by its proposer. A genuine rejection (voted down, threshold not reached) cannot be distinguished from a cancellation in audit logs or the event stream.

---

**Title:** `admin_multisig.rs` `execute_action` for `AdminAction::Other(_)` is a silent no-op
**Labels:** `bug` `contract`
**Body:** The match arm for `AdminAction::Other(_)` in `execute_action` is an empty block `{}`. A governance proposal of type `Other` can be fully approved, reach execution, succeed, and perform absolutely nothing — no state change, no event, no error. Add a `panic!("Unsupported action type")` or implement the intended behavior.

---

**Title:** `admin_multisig.rs` `get_proposal` has no authorization check — any account can read governance proposals
**Labels:** `bug` `security` `contract`
**Body:** `admin_multisig.rs` `get_proposal` reads and returns the full `AdminProposal` from instance storage with no `require_auth()` call. Any network participant can inspect the details of any pending admin governance proposal without being a signer or admin.

---

**Title:** `admin_multisig.rs` `approve_action` does not validate threshold vs. registered signer count
**Labels:** `bug` `contract`
**Body:** If the contract is initialized with `threshold = 5` and only 3 signers are ever registered, the threshold can never be reached. Approvals accumulate but no proposal can ever be executed. No validation at init time or during approval checks for this condition. Add a guard: `require threshold <= signers.len()` at initialization.

---

**Title:** `shadow.rs` `register_schema` writes a `String` then reads the same key as `Vec<String>` — panic on read
**Labels:** `bug` `contract`
**Body:** `shadow.rs` `register_schema` sets the name-index key to `schema.id` (a `String`). Later in the same function it reads that key expecting a `Vec<String>` for schema history. The stored type is incompatible with the expected type — deserialization will panic or produce garbage data.

---

**Title:** `shadow.rs` stores all metadata schemas in `instance()` storage — hits size limit rapidly
**Labels:** `bug` `contract`
**Body:** `shadow.rs` writes schemas, name indexes, history lists, and schema counts all to `env.storage().instance()`. Instance storage is a single ledger entry with a fixed maximum size (~16 KB in current Soroban). Storing many schemas will exhaust this limit and cause all subsequent schema writes to fail. Schemas should be stored in `persistent()` keyed by schema ID.

---

**Title:** `multisig.rs` stores all `PendingRequest` entries in `instance()` storage — unbounded growth
**Labels:** `bug` `contract`
**Body:** `multisig.rs` stores `PendingRequest`, `IssuerRequestIds`, and `SignerRequestIds` in `env.storage().instance()`. Instance storage is size-limited and grows unboundedly with every new request. Once the size limit is exceeded, all writes fail. Each pending request should be stored in `persistent()` storage under a unique key.

---

**Title:** `freeze_certificate` does not verify caller is still in the authorized issuer list
**Labels:** `bug` `security` `contract`
**Body:** `lib.rs` `freeze_certificate` calls `cert.issuer.require_auth()`, which requires the stored issuer address to authorize. However it does not check whether that issuer is still in the active authorized-issuers list. An issuer who has been removed via `remove_issuer()` can still freeze certificates they previously issued. Add a check that `DataKey::Issuer(cert.issuer)` resolves to `true` in persistent storage.

---

**Title:** `update_certificate_metadata` panics for frozen certificates — no unfreeze-update-refreeze path
**Labels:** `enhancement` `contract`
**Body:** `update_certificate_metadata` panics if `cert.status != Active`. A frozen certificate cannot have its metadata corrected without the issuer unfreezing it first, which creates a window where the certificate is temporarily unfrozen. Consider allowing metadata-only updates for frozen certificates, or document the required workaround prominently.

---

<!-- ============================================================= -->
<!-- Findings added 2026-08-27 after booting the full stack        -->
<!-- (backend + frontend + docker services) and running an audit.  -->
<!-- These are NEW issues, distinct from the ones above.           -->
<!-- ============================================================= -->

## Backend (new)

---

**Title:** Logout / token blacklist is never enforced on protected routes
**Labels:** `bug` `security` `backend`
**Body:** `AuthService.logout` blacklists the access token via `JwtManagementService.blacklistToken` (cache-backed), but the request-time [jwt-auth.guard.ts:58-65](backend/src/common/guards/jwt-auth.guard.ts#L58-L65) only calls `jwtService.verify(token)` and never calls `isTokenBlacklisted`; the passport [jwt.strategy.ts:38-56](backend/src/modules/auth/strategies/jwt.strategy.ts#L38-L56) also never consults the blacklist. As a result, logout has zero effect — a "logged out" token keeps working until natural expiry. The guard also never checks `user.isActive`/existence, so a suspended or deleted user's still-valid token keeps authenticating. Fix: make `JwtAuthGuard` async, check the blacklist, and re-load the user (active check), or route all auth through a single guard that does both.

---

**Title:** `CryptoUtils.verifyHMAC` uses a timing-unsafe `===` comparison
**Labels:** `bug` `security` `backend`
**Body:** [crypto.utils.ts:76-79](backend/src/common/utils/crypto.utils.ts#L76-L79) compares signatures with `expectedSignature === signature`, which short-circuits on the first differing byte and leaks timing information usable to forge HMAC signatures byte-by-byte. Fix: use `crypto.timingSafeEqual` on equal-length buffers (guarding for a length mismatch first).

---

**Title:** Certificate verification codes and IDs are generated with `Math.random()`
**Labels:** `bug` `security` `backend`
**Body:** `generateVerificationCode()` and `generateCertificateId()` in `certificate-issuance.service.ts:141-158` and `certificate.service.ts:842-852` (and the transfer `generateConfirmationCode()` in `certificate-transfer.service.ts:340-347`) draw every character from `Math.random()`. Verification codes are the primary secret behind the public `verifyCertificate` endpoint, and transfer confirmation codes gate ownership changes, so predictable values undermine the core trust model. There is also no DB uniqueness check on the 8-char code, allowing silent collisions. Fix: generate from `crypto.randomBytes` and enforce a unique constraint / retry on collision.

---

**Title:** Certificate verification checks status but not expiry
**Labels:** `bug` `backend`
**Body:** `findByVerificationCode` in `certificate-verification.service.ts:21-38` filters on `status = 'active'` but never checks `expiresAt`, even though the entity exposes an `isExpired()` getter (`certificate.entity.ts:174-177`). Any certificate whose `expiresAt` has passed but which has not yet been swept by the expiration job verifies as fully valid and even emits a `CERTIFICATE_VERIFIED` webhook. Fix: add `AND (certificate.expiresAt IS NULL OR certificate.expiresAt > NOW())` to the query, or reject when `isExpired()`.

---

**Title:** Transfer confirmation code is sent to the initiator, not the intended new owner
**Labels:** `bug` `backend`
**Body:** Both the "initiated" and "completed" notifications in `certificate-transfer.service.ts:104-109,216-221` are created for `initiatorId`/`approverId`, and the initiation notification embeds the secret `confirmationCode`. The new owner (`toEmail`) is never notified and never receives the code, so the intended flow (new owner confirms with the code) is impossible — effectively the initiator both starts and approves the transfer. Fix: send the confirmation-code notification/email to `toEmail`, and notify the recipient on completion.

---

**Title:** 2FA verification endpoint has no rate limiting (brute-force)
**Labels:** `bug` `security` `backend`
**Body:** `AuthRateLimitMiddleware` is applied only to `auth/login` and `auth/register` (`auth.module.ts:56-63`). The `2fa/verify` route and `validateLogin` (`two-factor.service.ts:97-131`) have no attempt throttling or lockout, so a 6-digit TOTP (or 8-hex-char backup code) can be brute-forced within the 5-minute pre-auth window. Fix: apply rate limiting / attempt-counting to `2fa/verify` and invalidate the pre-auth token after a few failures.

---

**Title:** `AuthRateLimitMiddleware`: spoofable IP, wrong TTL unit, window-reset-on-hit, fail-open
**Labels:** `bug` `security` `backend`
**Body:** [auth-rate-limit.middleware.ts:14,29-40](backend/src/modules/auth/middleware/auth-rate-limit.middleware.ts#L14) keys on `req.headers['x-forwarded-for']` without sanitization (an attacker rotating that header bypasses the 5/min login cap); writes TTL as `{ ttl: this.windowSeconds }` (the cache-manager v4 shape — under v5 the arg must be milliseconds, so entries may never expire or expire at the wrong time); re-`set`s the counter on every hit (resetting the window each request); and fails open on any cache error (disabling brute-force protection during a cache outage). Fix: derive client IP from trusted-proxy config, use the correct TTL unit, avoid resetting TTL on increment, and fail closed for auth.

---

**Title:** User-defined regex patterns in metadata schemas enable ReDoS / uncaught 500s
**Labels:** `bug` `security` `backend`
**Body:** `validateField` in `metadata-schema.service.ts:250-260` compiles `new RegExp(field.pattern)` from issuer-controlled schema data and runs it against submitted metadata. A malicious/careless pattern (e.g. `(a+)+$`) causes catastrophic backtracking (ReDoS) that blocks the event loop, and an invalid pattern string throws an uncaught `SyntaxError` → 500. Fix: validate/limit patterns at schema-creation time, run matching with a safe-regex library or timeout, and wrap compilation in try/catch.

---

**Title:** `MetadataSchemaService.update` bypasses the `(name, version)` uniqueness guard
**Labels:** `bug` `backend`
**Body:** `create` rejects duplicate `(name, version)` pairs, but `update` (`metadata-schema.service.ts:88-105`) does a blanket `Object.assign(schema, dto)` and saves, allowing an existing schema's `name`/`version` to be changed to collide with another record with no conflict check. This corrupts the versioning invariant that `findLatestByName`/`upgradeSchema` rely on. Fix: disallow mutating `version` (or re-run the uniqueness check) inside `update`.

---

**Title:** Several certificate list/search/export queries are unbounded (no pagination/limit)
**Labels:** `enhancement` `performance` `backend`
**Body:** `getCertificatesByRecipient`, `getCertificatesByIssuer`, `getDuplicateCertificates`, `exportCertificates`, and `search` in `certificate-search.service.ts:57-135` all call `getMany()` with no `take`/pagination, loading every matching row into memory and JSON-serializing it. On a large issuer this causes slow responses and potential OOM, and the endpoints are attacker-reachable amplification vectors. Fix: add pagination (limit/offset or keyset) and a hard maximum page size; stream exports.

---

**Title:** Certificate text search uses case-sensitive `LIKE` with unescaped wildcards
**Labels:** `bug` `backend`
**Body:** The search query in `certificate-search.service.ts:114-119` builds `LIKE :query` with `%${query}%`. On Postgres `LIKE` is case-sensitive, so `John` won't match `john`, and the raw input is not escaped, so `%`/`_` act as wildcards (a caller can pass `%` to match everything). Values are parameterized so this is not SQL injection, but it is a correctness bug. Fix: use `ILIKE` and escape `%`, `_`, `\` in the user term.

---

**Title:** Global input-sanitization middleware strips all control chars, corrupting multi-line/tab data
**Labels:** `bug` `backend`
**Body:** `sanitize` in `input-sanitization.middleware.ts:17-28` removes every character with code `< 32` (and 127) from all string bodies/queries/params, which deletes newlines, carriage returns, and tabs from legitimate fields such as multi-line certificate descriptions, addresses, or JSON-encoded metadata submitted as strings. Silently mutating every request body app-wide is both surprising and data-destroying, and the per-character `split('').filter()` is an unnecessary allocation on every request. Fix: preserve `\n`/`\r`/`\t`, scope sanitization to specific fields, or rely on the existing validation/sanitize pipes.

---

**Title:** `EmailService` initializes its transporter asynchronously in the constructor (send-before-ready race)
**Labels:** `bug` `backend`
**Body:** The `EmailService` constructor (`email.service.ts:30-35`) fires `initializeTransporter()` (async — it awaits `createTestAccount()`) without awaiting and only `.catch`-logs failures, while `this.transporter` stays `undefined` until it resolves. Any email send during startup (or after a failed init) dereferences `undefined.sendMail` and throws. Fix: implement `OnModuleInit` and `await` transporter setup there, or lazily initialize/guard `this.transporter` before each send.

---

## Frontend (new)

---

**Title:** `IssueCertificate.tsx` (component) has a broken dead function and fakes issuance
**Labels:** `bug` `frontend`
**Status:** ⚠️ Partially fixed 2026-08-27 — removed the dead `handleConfirmIssue` function (it blocked `tsc -b`). The **fake issuance still remains**: `handleSubmit` still just `await`s a 1500 ms timeout and `alert()`s success without calling any API. Still needs wiring to the real create-certificate API (or deletion, along with its aspirational `IssueCertificate.test.tsx`).
**Body:** `handleConfirmIssue` referenced `issueCertificate`, `payload`, `toast`, and `navigate`, none of which were imported or defined — a reference error in a function that was never called (it broke the production build). Separately, the actual `handleSubmit` just `await`s a 1500 ms timeout and shows `alert("Certificate issued successfully on the Stellar network!")` without calling any API, so the form always reports success while issuing nothing. The component is only imported by its own test.

---

**Title:** `ErrorBoundary` is defined but never mounted — a render error white-screens the whole app
**Labels:** `bug` `frontend`
**Body:** A working class-based `ErrorBoundary` exists (`components/ErrorBoundary.tsx`) but is imported by no file (verified). Because `App` (`App.tsx:41-172`) wraps the lazy `Suspense`/`Routes` tree without any error boundary, a render error or a failed `lazy()` chunk load white-screens the entire app with no recovery UI. Fix: wrap the `<Suspense>`/`<Routes>` (and ideally each lazy page) in `<ErrorBoundary>`.

---

**Title:** Socket token rotation relies on a same-tab `storage` event that never fires — realtime notifications silently stop
**Labels:** `bug` `frontend`
**Body:** `NotificationContext.tsx:84-94` comments that a `storage` listener "fires in the same tab via a custom dispatch," but `tokenStorage.setAccessToken` (`api/tokens.ts:22`) just calls `localStorage.setItem`, and the `storage` event only fires in _other_ tabs — no `dispatchEvent`/`StorageEvent` exists anywhere (verified). When `apiClient` silently refreshes the access token in the current tab, the WebSocket is never reconnected and keeps authenticating with the expired token, so realtime notifications stop. Fix: hook into the existing `setTokenRefreshCallback` mechanism to call `connectSocket(newToken)` on rotation.

---

**Title:** `isTokenExpired` uses `atob` on a base64url JWT payload — can misdecode/throw and spuriously log out
**Labels:** `bug` `frontend`
**Body:** `AuthContext.tsx:6-14` decodes the JWT payload with `atob`, but JWT segments are base64url (`-`/`_`) while `atob` expects standard base64; payloads containing those characters decode incorrectly or throw, and the `catch` then treats the token as expired. This can spuriously log a user out immediately after a valid login. Fix: convert base64url→base64 (`replace(/-/g,'+').replace(/_/g,'/')` + padding) before `atob`, or use a JWT-aware decoder.

---

**Title:** Post-registration flow logs the user in despite required email verification
**Labels:** `bug` `frontend`
**Body:** `registerApi`'s own comment (`api/endpoints.ts:919-924`) states "Registration requires email verification before login is allowed," yet on success `Login.tsx:44-55` immediately calls `login(...)` and `navigate(returnUrl)`. The user is dropped into the authenticated app with an unverified account and no "check your email" screen, and protected API calls then fail server-side. Fix: after registration, show a verification-pending state (using `requiresEmailVerification` from `AuthResponse`) instead of logging in and redirecting.

---

**Title:** Raw `fetch` calls bypass envelope unwrapping and 401-refresh handling
**Labels:** `tech-debt` `frontend`
**Body:** `certificateApi.bulkExport`, `bulkExportAll`, and `issuerProfileApi.uploadProfilePicture` (`api/endpoints.ts:685-695,743-754,1270-1287`) call `fetch` directly with a manually attached `Authorization` header. Unlike `apiClient`, they do not attempt a silent token refresh on 401, do not retry, and do not unwrap the `{ statusCode, message, data }` envelope, so an expired access token forces a hard mid-session failure and error shapes are inconsistent. Fix: route these through a shared client helper (e.g. an `apiClient` variant that returns a `Blob` / handles `FormData`).

---

**Title:** Notification-preferences link is a raw `<a href>` that triggers a full page reload
**Labels:** `tech-debt` `frontend`
**Body:** `NotificationDropdown.tsx:103` uses `<a href="/preferences">` instead of a React Router `<Link>`. Clicking it forces a full document navigation, tearing down and re-bootstrapping the SPA (re-fetching bundles, re-running auth/notification providers) instead of a client-side transition. Fix: replace with `<Link to="/preferences">`.

---

**Title:** Admin/analytics features are built but unreachable; a stray Next.js-style page is committed
**Labels:** `tech-debt` `frontend`
**Body:** `src/app/admin/users/page.tsx` uses the Next.js App Router convention (`page.tsx` default export) inside a Vite + React Router SPA; there is no `/admin` route in `App.tsx`, so it and `UserManagement` never render. `AdminAnalyticsDashboard` is only reachable indirectly via `Dashboard`, and several components (`CRLComponent`, `CertificateDemoPage`, `CsvExportButton`, `CertificateSearchBar`) are imported nowhere (verified). Fix: add proper React Router routes for the admin surface and remove or wire up the orphaned files.

---

## Stellar Contracts (new)

---

**Title:** `propose_certificate` performs no caller authorization (impersonation / spam)
**Labels:** `bug` `security` `contract`
**Body:** Neither `propose_certificate` implementation calls `issuer.require_auth()` — in `lib.rs` the intended call is the orphaned stray statement at line 879 (outside the function), and `multisig.rs:122-168` has none. Any account can create a `PendingRequest` naming an arbitrary `issuer`/`proposer` and pollute that issuer's and its signers' request indexes (`IssuerRequestIds`/`SignerRequestIds`) — an unauthenticated spam/DoS vector against paginated queries. Fix: add `issuer.require_auth();` as the first line of both functions.

---

**Title:** `lib.rs` `reject_request` does not verify the rejector is an authorized signer
**Labels:** `bug` `security` `contract`
**Body:** Unlike `approve_request` (which checks `config.signers.contains(&approver)`) and unlike `multisig.rs::reject_request` (which checks at line 274), `lib.rs::reject_request` (lines 987-1035) only calls `rejector.require_auth()` and never confirms the rejector is a configured signer. Any account can push rejections; once `signers.len() - rejections.len() < threshold` the request is force-set to `Rejected`, letting an outsider unilaterally kill any pending request. Fix: after loading `config`, panic/return failure if `!config.signers.contains(&rejector)`.

---

**Title:** `admin_multisig.rs` `AdminAction::UpgradeContract` upgrades the wrong contract
**Labels:** `bug` `contract`
**Body:** The `UpgradeContract` branch (`admin_multisig.rs:313-316`) calls `env.deployer().update_current_contract_wasm(...)`, which replaces the WASM of the AdminMultisig contract _itself_, not the certificate contract it governs. The certificate contract exposes its own `upgrade(new_wasm_hash)` guarded by admin auth (`lib.rs:1156`), which is presumably the intended target. As written, an approved "upgrade certificate contract" proposal silently bricks/replaces the admin multisig. Fix: `env.invoke_contract(&certificate_contract, &Symbol::new(&env,"upgrade"), ...)` using the stored contract id.

---

**Title:** `complete_transfer` never re-validates certificate status or current owner (double-transfer)
**Labels:** `bug` `security` `contract`
**Body:** `complete_transfer` (`lib.rs:603-686`) only checks the transfer's own status is `Accepted`; it re-reads the certificate but does not verify `cert.status == Active` nor that `cert.owner == transfer.from_owner`. Since `initiate_transfer` does not prevent multiple concurrent pending transfers, owner A can initiate transfers to both B and C; after completing A→B, completing A→C reads `cert.owner` (now B) as `previous_owner`, removes B from the owner index, and reassigns the cert to C — stripping B without consent. It also allows completing a transfer of a certificate frozen/revoked after acceptance. Fix: assert `cert.owner == transfer.from_owner` and `cert.status == Active`, and/or block a second pending transfer per certificate.

---

**Title:** `reissue_certificate` does not index the new certificate and leaves the old one active
**Labels:** `bug` `contract`
**Body:** `issue_certificate` records new certs in `IssuerCertIds`/`OwnerCertIds`, but `reissue_certificate` (`lib.rs:400-476`) only stores the certificate and emits an event — it never calls `append_cert_id`. Reissued certificates are therefore invisible to `get_certificates_by_issuer` / `get_certificates_by_owner`. The parent (`old_id`) is also left `Active`, so both parent and child are simultaneously valid despite "reissue/supersede" semantics. Fix: append the new id to both indexes and mark the original `Revoked`/`Superseded` (emitting a revocation event).

---

**Title:** Issued certificate expiry is set to the request's approval deadline
**Labels:** `bug` `contract`
**Body:** `issue_approved_certificate` (`lib.rs:1049-1056`, `multisig.rs:335-346`) passes `Some(request.expires_at)` as the certificate's `expires_at`. But `request.expires_at` was computed as `created_at + expiration_days*86400` and is the _proposal approval deadline_, not a certificate lifetime. The resulting certificate expires the moment the proposal would have timed out (often days), rather than having a proper validity period. Fix: carry a separate `cert_expires_at` on `PendingRequest`, or compute certificate expiry from issuance time.

---

**Title:** `batch_verify_certificates` treats `Frozen` certificates as valid
**Labels:** `bug` `contract`
**Body:** The `is_revoked` computation in `batch_verify_certificates` (`lib.rs:1214-1217`) counts `Revoked`, `Suspended`, `Expired`, and time-expiry, but omits `CertificateStatus::Frozen`. A frozen certificate is thus reported as `revoked: false` and counted as `successful`, contradicting `is_valid` (`lib.rs:358`) which returns `false` for any non-`Active` status. Verifiers relying on batch results treat frozen certs as good. Fix: add `|| cert.status == CertificateStatus::Frozen` (better: invalid == `status != Active || time-expired`).

---

**Title:** `lib.rs` `cancel_request` can cancel already-issued/approved requests
**Labels:** `bug` `contract`
**Body:** `cancel_request` (`lib.rs:1140-1153`) sets `status = Cancelled` after only checking `proposer == requester`; it does not verify the request is still `Pending`. The proposer can therefore mark an `Approved` or already-`Issued` request as `Cancelled`, corrupting state and misleading indexers. (The `multisig.rs` twin at line 397 correctly returns `false` for non-pending.) Fix: return early / panic unless `request.status == RequestStatus::Pending`.

---

**Title:** `crl.rs` `build_merkle_root` panics on certificate IDs longer than 256 bytes (revocation DoS)
**Labels:** `bug` `contract`
**Body:** Leaf construction in `crl.rs:326-329` uses a fixed `let mut buf = [0u8; 256];` and `id.copy_into_slice(&mut buf[..len])` where `len = id.len()`. If any revoked certificate ID exceeds 256 bytes, `buf[..len]` is out of bounds and panics, so `revoke_certificate` (which calls `refresh_crl_info` → `build_merkle_root` over all revoked IDs) aborts. A single over-long ID permanently blocks all further revocations for that issuer. Fix: build the `Bytes` directly from the `String` length without a fixed stack buffer, or reject over-long IDs at issuance.

---

**Title:** `crl.rs` Merkle tree lacks leaf/node domain separation and duplicates odd leaves
**Labels:** `security` `contract`
**Body:** In `crl.rs:293-351`, leaves are `sha256(id)` and internal nodes are `sha256(left || right)` with no domain-separation tag distinguishing the two, and odd nodes are promoted by duplicating the last leaf. This is the classic Merkle second-preimage/forgery weakness: an attacker can present an internal node as if it were a leaf, or exploit odd-duplication to craft alternative trees with the same root, undermining any off-chain inclusion proof against `merkle_root`. Fix: prefix leaves with `0x00` and internal nodes with `0x01` before hashing, and handle odd counts without silent duplication.

---

<!-- ============================================================= -->
<!-- Second audit batch — added 2026-08-27.                        -->
<!-- Covers areas not reached in the first pass: infra/DevOps/CI,   -->
<!-- backend bootstrap/config/DB/stellar, more frontend surface,    -->
<!-- and remaining contract modules. All findings verified against  -->
<!-- source; a sample were independently re-verified.               -->
<!-- ============================================================= -->

## Infrastructure / DevOps / CI

---

**Title:** `VITE_API_URL` points at internal Docker host `backend` and drops `/v1` — the browser SPA cannot reach the API
**Labels:** `bug` `devops`
**Body:** The frontend is a browser app, so [docker-compose.yml:94](docker-compose.yml#L94) `VITE_API_URL: http://backend:3000/api` is unusable: `backend` resolves only inside the Docker network, not in the user's browser (which needs `http://localhost:3000`), and it omits the `/v1` version segment the backend requires. Also, Vite bakes env at build time, so this must be a build arg, not a runtime env. Fix: set `VITE_API_URL: http://localhost:3000/api/v1` (or route via nginx) and pass it as a build arg.

---

**Title:** No `.dockerignore` — `COPY . .` bakes `node_modules`, `.env`, and `.git` into images
**Labels:** `security` `devops`
**Body:** Both Dockerfiles do `COPY . .` with no `.dockerignore` anywhere in the repo (verified via `find`), so any local `.env` (real secrets), the entire `.git` history, and host `node_modules` (native binaries built for the wrong platform) get copied into image layers. Secrets copied into a layer persist even if later deleted. Fix: add `.dockerignore` files excluding `node_modules`, `.env*`, `.git`, `dist`, `coverage`, etc.

---

**Title:** `deploy-contracts.sh` echoes the admin secret key to stdout
**Labels:** `security` `devops`
**Body:** The final "copy these to your .env" block at [deploy-contracts.sh:114](deploy-contracts.sh#L114) prints `SOROBAN_ADMIN_SECRET=$ADMIN_SECRET`, dumping the raw Stellar admin secret into terminal scrollback and — if ever run in CI — into retained, potentially world-readable build logs. Anyone with that secret controls the deployed contracts. Fix: never echo the secret; instruct the operator to reuse the value they supplied, or write it to a `0600` file.

---

**Title:** `deploy-contracts.sh` mis-uses the Soroban CLI: treats a contract ID as a WASM hash and deploys the same WASM for all three contracts
**Labels:** `bug` `devops`
**Body:** [deploy-contracts.sh:32-104](deploy-contracts.sh#L32-L104) captures `CERT_WASM_HASH=$(soroban contract deploy ...)` — which returns a _contract ID_, not a WASM hash — then passes it to `--wasm-hash`, so the next deploy is malformed (hashes come from `contract install`). The multisig and CRL steps deploy the identical `certificate_revocation.wasm`, so all three "contracts" are the same code, and the `soroban` binary/`config network` usage is deprecated (renamed to the `stellar` CLI). Fix: use `stellar contract install` for the hash, deploy the correct per-contract WASM files, and migrate to the current CLI.

---

**Title:** `docker-compose` runs `NODE_ENV=production` with a hardcoded fallback `JWT_SECRET=change_me_in_production`
**Labels:** `security` `devops`
**Body:** [docker-compose.yml:50,63](docker-compose.yml#L50) sets `NODE_ENV: production` while defaulting `JWT_SECRET: ${JWT_SECRET:-change_me_in_production}`. If an operator brings the stack up without exporting `JWT_SECRET`, the API boots in production mode signing/verifying JWTs with a publicly known secret, enabling trivial token forgery and full auth bypass. The DB password is likewise a hardcoded literal (`stellarwave_password`). Fix: remove the insecure default so startup fails fast when `JWT_SECRET` is unset, and source DB credentials from secrets.

---

**Title:** Postgres migration bind-mount is ineffective — TypeORM `.ts` migrations mounted into a subdir the entrypoint never runs
**Labels:** `bug` `devops`
**Body:** [docker-compose.yml:14](docker-compose.yml#L14) mounts `./backend/src/database/migrations` into `/docker-entrypoint-initdb.d/migrations`, but the Postgres image only executes top-level `*.sql`/`*.sh` files (not nested subdirs), and TypeORM migrations are TypeScript, not SQL — so no schema is ever created this way. Yet `DOCKER_STARTUP_GUIDE.md:107` claims "the backend will automatically run database migrations." Fix: run migrations from the backend container on startup (e.g. `typeorm migration:run` in an entrypoint) and correct the guide.

---

**Title:** Backend Dockerfile uses `npm install` (not `npm ci`) and leaves the build toolchain in the final image
**Labels:** `tech-debt` `devops`
**Body:** Both stages of [backend/Dockerfile](backend/Dockerfile) run `npm install --legacy-peer-deps` rather than `npm ci`, so builds are non-reproducible and ignore the committed lockfile; the production stage also `apk add python3 g++ make` and never removes them, bloating the image and enlarging the runtime attack surface. Fix: use `npm ci --omit=dev`, and install native build deps in a throwaway stage so the final image is toolchain-free.

---

**Title:** `.env.example` defaults to `NODE_ENV=production`, ships a placeholder secret, and omits required variables
**Labels:** `enhancement` `devops`
**Body:** Copying the example (as the guide instructs) yields `NODE_ENV=production` and a literal `JWT_SECRET=your-super-secret-jwt-key-change-this-in-production`, nudging developers into prod mode with a placeholder secret. It also omits variables the stack needs: the Soroban block lives only in `.env.soroban.example`, and `STORAGE_REQUIRED`, `EMAIL_*`, and `EMAIL_QUEUE_NAME` (referenced in `main.ts:27`) are absent. Fix: default the example to `NODE_ENV=development`, mark secrets as clearly fake, and consolidate all required keys into one documented template.

---

## Backend (second batch)

---

**Title:** TypeORM `migrations` glob points at the wrong directory — migrations never execute
**Labels:** `bug` `backend`
**Body:** [typeorm.config.ts:14](backend/src/config/typeorm.config.ts#L14) sets `migrations: [__dirname + '/../migrations/*{.ts,.js}']`, resolving to `src/migrations`/`dist/migrations`, but the only migration lives in `src/database/migrations/1780272000000-AddPasswordResetLookupAndRecipientName.ts`. With `migrationsRun: true`, the glob matches nothing, so the schema change is never applied on a fresh deploy — the app silently relies on `synchronize` instead. Fix: point the glob at `__dirname + '/../database/migrations/*{.ts,.js}'`.

---

**Title:** `synchronize: true` in every non-production environment risks silent schema/data changes
**Labels:** `security` `backend`
**Body:** [typeorm.config.ts:11,15](backend/src/config/typeorm.config.ts#L11) enables `synchronize` whenever `NODE_ENV !== 'production'` while `migrationsRun` is also `true`, mixing two conflicting schema strategies. Any environment where `NODE_ENV` is unset or mistyped (`Production`, `prod`) is treated as non-production and TypeORM auto-alters/drops columns to match entities, risking data loss. Fix: drive `synchronize` from an explicit boolean env flag defaulting to `false`, and never combine it with `migrationsRun`.

---

**Title:** No SSL/TLS option for the database connection
**Labels:** `security` `backend`
**Body:** The Postgres config in [typeorm.config.ts:3-16](backend/src/config/typeorm.config.ts#L3-L16) never sets `ssl`. In managed-Postgres/production deployments the connection (credentials and all certificate PII) travels unencrypted, and many providers reject non-SSL connections outright. Fix: add an env-driven `ssl` option (e.g. `ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined`, or a CA-pinned config).

---

**Title:** Bull-Board queue dashboard mounted at `/admin/queues` with no authentication
**Labels:** `security` `backend`
**Body:** [app.module.ts:52-55](backend/src/app.module.ts#L52-L55) mounts `BullBoardModule.forRoot({ route: '/admin/queues', ... })`, an Express router that is not a Nest controller, so the global `JwtAuthGuard`/`RolesGuard` never protect it. Anyone can browse, retry, and delete jobs — including email/webhook payloads containing PII and tokens. Fix: put the dashboard behind auth middleware (basic-auth or a JWT/admin check) on `/admin/queues`, or disable it in production.

---

**Title:** Swagger UI and full API spec are exposed unconditionally, even in production
**Labels:** `security` `backend`
**Body:** [main.ts:85-101](backend/src/main.ts#L85-L101) runs `SwaggerModule.setup('api/docs', ...)` on every boot with no `NODE_ENV` guard, publishing the complete endpoint/DTO catalog (auth, admin, multisig, audit) to unauthenticated users in production — a reconnaissance aid for attackers. Fix: wrap the Swagger setup in `if (process.env.NODE_ENV !== 'production')` or protect `api/docs` behind auth.

---

**Title:** Registration issues full tokens to unverified accounts; login never checks email verification
**Labels:** `security` `backend`
**Body:** `register()` sets `status: PENDING_VERIFICATION` yet immediately calls `generateTokens(user)` and returns them (`user-auth.service.ts:80-100`), and `login()` only rejects `SUSPENDED`/`!isActive` — never `isEmailVerified`/`PENDING_VERIFICATION` (`user-auth.service.ts:103-170`). Email verification is therefore effectively optional: a user can operate the entire authenticated API without confirming ownership of the email, enabling signup with someone else's address. Fix: do not return tokens on register, and block (or scope-limit) login until `isEmailVerified === true`. (Pairs with the frontend "logs in despite required verification" issue.)

---

**Title:** `User.role` column defaults to `ISSUER` — privilege escalation on any creation path that omits role
**Labels:** `security` `backend`
**Body:** [user.entity.ts:47-52](backend/src/modules/users/entities/user.entity.ts#L47-L52) declares `@Column({ ... default: UserRole.ISSUER })`. `register` overrides this with `USER`, but any other insert path (admin create flows, seeds, direct `repository.create` without a role) silently produces an ISSUER-privileged account able to mint certificates. Fix: default the column to the least-privileged role and set elevated roles explicitly.

---

**Title:** Soroban transactions are submitted without simulate/prepare and with a fixed 100-stroop fee — invocations cannot succeed; reads waste a real transaction
**Labels:** `bug` `backend` `stellar`
**Body:** Every `contract.call(...)` in [soroban.service.ts:104-116,260-270,336-356](backend/src/modules/stellar/services/soroban.service.ts#L104-L116) is built and signed with `fee: '100'` and no `server.prepareTransaction()`/`simulateTransaction()` step, so it lacks the Soroban resource footprint and resource fee the network requires — such transactions are rejected. Additionally, the read-only `getCertificate` is executed via `sendTransaction`, paying for a real on-chain transaction instead of a free simulation. Fix: simulate/prepare all invocations to attach footprint+fee, and use `simulateTransaction` for read-only calls.

---

**Title:** `getIssuerKeypair` always returns the admin keypair — all on-chain issuance/revocation is signed as the admin
**Labels:** `security` `backend` `stellar`
**Body:** The placeholder `getIssuerKeypair` in [soroban.service.ts:232-268](backend/src/modules/stellar/services/soroban.service.ts#L232-L268) ignores `issuerAddress` and returns `this.adminKeypair`, so `issueCertificate`/`revokeCertificate` are signed by the platform admin regardless of the real issuer. This collapses per-issuer authorization, makes on-chain provenance meaningless, and concentrates all signing authority in one key. Fix: implement real per-issuer key management (custodial signer service or delegated auth).

---

**Title:** `trust proxy` is unconditionally `true`, making `X-Forwarded-For` fully spoofable app-wide
**Labels:** `security` `backend`
**Body:** [main.ts:18-19](backend/src/main.ts#L18-L19) sets `expressApp.set('trust proxy', true)`, telling Express to trust the client-supplied `X-Forwarded-For` from any peer, so `request.ip` and every XFF-derived value (rate-limit buckets, audit `ipAddress`, brute-force keys) can be forged by adding a header. This is the upstream root cause behind several IP-based controls being bypassable. Fix: set `trust proxy` to the specific hop count or CIDR of the known load balancer, not `true`.

---

**Title:** App-wide `RateLimitGuard` uses an unbounded process-local `Map` — memory leak and multi-instance bypass
**Labels:** `bug` `backend`
**Body:** [security/guards/rate-limit.guard.ts:40,169-208](backend/src/modules/security/guards/rate-limit.guard.ts#L169-L208) creates a `LocalBucket` per distinct `user:/ip:/apiKey:`+route combination in an in-memory `Map` that is never swept, so under real traffic the map grows until OOM. Being process-local, counts reset on restart and are trivially bypassed by round-robining across replicas, and `clientIp` reads the spoofable first `x-forwarded-for` entry. (Distinct from the already-filed `ip-rate-limit.guard`.) Fix: back the limiter with Redis (shared, TTL-expiring keys) and derive client IP from trusted-proxy config.

---

**Title:** Global validation pipe returns the sanitized plain object instead of the transformed DTO, discarding type coercion; also registered twice
**Labels:** `bug` `backend`
**Body:** [request-validation.pipe.ts:22,38](backend/src/modules/security/pipes/request-validation.pipe.ts#L22) validates `plainToClass(metatype, sanitizedValue)` but then `return sanitizedValue` — the un-transformed value — so `@Type(() => Number)`/`@Transform` conversions are thrown away and controllers receive raw strings from query/body. The pipe is also registered twice (as `APP_PIPE` in `common.module.ts` and again via `app.useGlobalPipes` in `main.ts:74`), running on every request twice. Fix: `return object` (the transformed instance) and register the pipe once.

---

**Title:** Audit CSV export is silently truncated to 500 rows
**Labels:** `bug` `backend`
**Body:** `exportToCsv` calls `this.search({ ...searchDto, skip: 0, take: 50000 })` (`audit.service.ts:347-348`), but `search()` clamps `take` with `Math.min(searchDto.take || 50, 500)` (line 196). Admin CSV exports therefore never contain more than 500 records regardless of range, producing incomplete compliance exports with no error. Fix: give `exportToCsv` its own query path (or a higher, explicit cap with streaming) that bypasses the UI cap.

---

**Title:** Health endpoints leak raw error objects to unauthenticated callers
**Labels:** `security` `backend`
**Body:** The `@Public()` health controller builds `new HttpException({ ..., error }, ...)` in each catch block (`health.controller.ts:44-54,81-90,128-141,...`), embedding the raw caught error into the 503 body. A failing DB/Redis/Stellar check thus returns internal messages (connection strings, hostnames, stack fragments) to anyone hitting `/api/v1/health/*`. Fix: log the error server-side and return only a generic status string to the client.

---

**Title:** `AuditLog` is indexed on `createdAt` but all queries filter/sort/purge by `timestamp`
**Labels:** `tech-debt` `backend` `performance`
**Body:** Every search (`audit.timestamp BETWEEN`), the default `orderBy('audit.timestamp','DESC')`, and `cleanupOldLogs` (`timestamp <= cutoff`) operate on the unindexed `bigint timestamp` column, while the `@Index()` sits on the near-identical `createdAt` (`audit-log.entity.ts:15,120-123`). As the table grows this forces sequential scans/sorts on the hottest column. Fix: add `@Index(['timestamp'])` and drop the redundant `createdAt` index if unused.

---

**Title:** `certificate.verificationCode` and `expiresAt` are not indexed — public verification does a full table scan
**Labels:** `tech-debt` `backend` `performance`
**Body:** Roughly a dozen fields on `certificate.entity.ts` carry `@Index()`, but `verificationCode` (line 123, the lookup key for the public unauthenticated verify endpoint) and `expiresAt` (line 159, scanned by the expiration job) have none. The most attacker-reachable query in the system therefore scans the entire certificates table per request — an easy amplification/DoS vector. Fix: add a unique `@Index()` to `verificationCode` and an `@Index()` to `expiresAt`.

---

## Frontend (second batch)

---

**Title:** `VerifyCertificate` statically imports `html5-qrcode`, bloating the public verify chunk (~380 kB) for all visitors
**Labels:** `performance` `frontend`
**Body:** `import { Html5QrcodeScanner } from 'html5-qrcode'` at [VerifyCertificate.tsx:4](frontend/src/pages/VerifyCertificate.tsx#L4) pulls the entire scanner library into the lazy verify chunk, so every visitor to the public `/verify` page downloads the camera/QR decoder even when they only type a serial. The existing `QRScannerModal.tsx` does this correctly via `await import("html5-qrcode")`. Fix: dynamic-import the library only when the scanner opens (or reuse `QRScannerModal`).

---

**Title:** Debounced auto-verify fires a public API call on every keystroke while typing a serial
**Labels:** `enhancement` `frontend`
**Body:** The effect at `VerifyCertificate.tsx:102-106` calls `handleVerify(debouncedSerial)` whenever the debounced input exceeds 2 characters, so as a user types a serial they trigger a stream of `/certificates/verify/...` requests that mostly return "not found," flashing a red "Verification Failed" panel until the last character is typed. Fix: only auto-verify on explicit submit / QR scan / URL param, or gate on a plausibly-complete length and suppress the error panel until submission.

---

**Title:** Login form inputs have no associated labels or `autocomplete` — accessibility and password-manager failures
**Labels:** `bug` `frontend` `a11y`
**Body:** In `Login.tsx:88-124` none of the `<label>`s use `htmlFor` and none of the inputs have an `id`, so labels are not programmatically associated — screen readers announce unlabeled fields and clicking a label doesn't focus its input. There are also zero `autoComplete` attributes anywhere in the app, so browsers/password managers can't offer `email`/`current-password`/`new-password` autofill. Fix: add matching `id`/`htmlFor` pairs and appropriate `autoComplete` values.

---

**Title:** `QRScannerModal` is not an accessible dialog — no focus trap, no `role`/`aria-modal`, no Escape-to-close
**Labels:** `bug` `frontend` `a11y`
**Body:** The modal root (`QRScannerModal.tsx:186-289`) is a plain `<div>` with a click-to-dismiss backdrop but no `role="dialog"`, `aria-modal="true"`, `aria-label`, focus trapping, initial-focus management, or `Escape` handler. Keyboard-only and screen-reader users cannot perceive it as a modal or dismiss it without a mouse, and focus can escape behind the overlay. Fix: add dialog semantics, trap focus, focus the close button on open, and close on `Escape`.

---

**Title:** `QRScannerModal` injects a Google Fonts `@import` and reaches into html5-qrcode private internals
**Labels:** `security` `frontend`
**Body:** The component renders `<style dangerouslySetInnerHTML>` whose CSS begins with `@import url('https://fonts.googleapis.com/...')` (`QRScannerModal.tsx:506-536`), adding a runtime third-party request from inside a security-sensitive verification flow (privacy/CSP concern). Separately, torch control accesses `scanner._localMediaStream` (`QRScannerModal.tsx:142-146`), an undocumented private field that will silently break on any library upgrade. Fix: self-host the font / move styles to CSS, and obtain the `MediaStreamTrack` through a supported API.

---

**Title:** `VerifyCertificate` has dead toast UI and uses `window.alert` for "Copy Link" feedback
**Labels:** `tech-debt` `frontend`
**Body:** `toast`/`setToast` state and its auto-dismiss effect exist (`VerifyCertificate.tsx:46,109-113`), but `setToast` is never called with a message (only `setToast(null)`), so the styled toast is unreachable dead code. Meanwhile the Copy-Link handler (line 488-494) falls back to a blocking `window.alert('Link copied to clipboard!')`, and `navigator.clipboard.writeText` is neither awaited nor error-handled (fails silently over HTTP or when permission is denied). Fix: drive the existing toast on copy success/failure and remove the alert.

---

**Title:** Duplicate QR-scanner implementations; the better lazy-loaded `QRScannerModal` is orphaned
**Labels:** `tech-debt` `frontend`
**Body:** Two full QR scanners exist: `VerifyCertificate` rolls its own with `Html5QrcodeScanner`, while the more capable `QRScannerModal` (torch, camera flip, dynamic import, friendly error mapping) is imported only by the unrouted `CertificateDemoPage`, so it never ships to users. This is duplicated, diverging maintenance surface. Fix: delete one implementation and route the survivor (prefer `QRScannerModal`).

---

**Title:** Theme applied only in a post-mount `useEffect` — flash of wrong theme (FOUC) on load
**Labels:** `enhancement` `frontend`
**Body:** `applyTheme` runs inside a `useEffect` after React mounts (`ThemeContext.tsx:54-60`), so the initial HTML paints without the `dark` class before hydration corrects it; a dark-mode user sees a white flash on every full load. Fix: add a tiny inline `<script>` in `index.html` that reads `localStorage`/`prefers-color-scheme` and sets `document.documentElement.classList` before the app bundle executes.

---

**Title:** `tsconfig.app.json` omits `noUnusedLocals`/`noUnusedParameters` and ESLint doesn't enforce unused-var cleanup
**Labels:** `tech-debt` `frontend`
**Body:** Despite `strict: true`, neither `noUnusedLocals` nor `noUnusedParameters` is enabled (`tsconfig.app.json:2-21`) and the ESLint config adds no `@typescript-eslint/no-unused-vars` rule — yet `lint` runs with `--max-warnings 0`. This lets dead bindings accumulate unchecked, and committed `lint-report.json`/`eslint_out.json` artifacts suggest lint isn't consistently green. Fix: enable the unused-code compiler flags, add the ESLint rule, and remove the stray report artifacts from source control.

---

## Stellar Contracts (second batch)

---

**Title:** Persistent-entry TTL is bumped only on write, never on read — certificates silently expire from storage
**Labels:** `bug` `contract`
**Body:** Only `set_persistent` calls `persistent::extend_ttl` (`lib.rs:57-64`, `storage/ttl.rs:7-15`); every read path (`get_certificate`, `is_valid`, `batch_verify_certificates`, `certificate_exists`, pagination) does zero TTL bumping. A certificate issued once and never mutated has its persistent entry TTL fixed at issuance, and if it is not written again within that window the ledger entry is archived/evicted — the data becomes unreadable even though the certificate may be valid for years. Fix: bump TTL on read for hot entries (call `extend_ttl` inside `get_certificate`/`is_valid`), or expose a `bump_certificate_ttl` maintenance entry point and document the archival-restore requirement.

---

**Title:** `DEFAULT_TTL` conflates seconds with ledgers — the value is ~5× larger than its "30 days" comment
**Labels:** `bug` `contract`
**Body:** `DEFAULT_TTL = 30 * 24 * 60 * 60 = 2,592,000` is labeled "30 days in ledger blocks" (`storage/ttl.rs:4`), but Soroban TTL is measured in ledgers (~5 s each), so 2,592,000 ledgers is roughly 150 days, not 30 — the value was computed as seconds. As the default extension on every persistent write, the real archival horizon differs materially from intent, compounding the TTL-on-read bug above. Fix: compute from the real ~5 s ledger close time (e.g. `30 * 24 * 60 * 60 / 5`) or document the units unambiguously.

---

**Title:** Pagination indexing is inconsistent _within_ `lib.rs` (0-indexed certs vs 1-indexed requests)
**Labels:** `bug` `contract`
**Body:** `paginate_certificates` computes `start = page.saturating_mul(limit)` (0-indexed) at `lib.rs:1333`, while `paginate_requests` computes `start = page.saturating_sub(1).saturating_mul(limit)` (1-indexed, per its comment) at `lib.rs:1434-1438`. A client using `page=1` gets the first page of requests but the _second_ page of certificates, and `page=0` returns page 1 of certs but an empty/underflowed request page. (Distinct from the crl-vs-lib mismatch already filed.) Fix: standardize both on 1-indexed and share a single helper.

---

**Title:** Release profile has no `overflow-checks` — arithmetic wraps silently in the deployed WASM
**Labels:** `security` `contract`
**Body:** `[profile.release]` in [Cargo.toml:16-20](stellar-contracts/Cargo.toml#L16-L20) sets `panic = "abort"` but omits `overflow-checks = true`, so unchecked arithmetic — `expires_at = timestamp() + expiration_days*86400` (`lib.rs:911`, `multisig.rs:155`), `count + 1` counters, `total_cost = BASE + COST_PER_CERTIFICATE * ids.len()` (`lib.rs:1240`) — wraps instead of trapping in production. Debug builds trap while release silently corrupts, masking bugs until mainnet. Fix: add `overflow-checks = true` to `[profile.release]` and/or convert to `checked_add`/`saturating_*`.

---

**Title:** `set_certificate_expiry` doesn't validate the new expiry (may be in the past) or the certificate status
**Labels:** `bug` `contract`
**Body:** `set_certificate_expiry` (`lib.rs:1252-1272`) lets the admin set `expires_at` to any `u64`, including a past timestamp, which immediately makes `is_valid` return `false` with no warning; it also does not require the certificate to be `Active`, so it can silently re-date a revoked/frozen certificate. There is no lower-bound check against `env.ledger().timestamp()`. Fix: `panic!` if `expiry_time <= env.ledger().timestamp()`, and reject non-`Active` certificates (or document the intent).

---

**Title:** `transfer_fee` is recorded on every transfer but never charged or moved
**Labels:** `bug` `contract`
**Body:** `initiate_transfer` accepts a `transfer_fee: u64`, stores it on the `CertificateTransfer`, and copies it into `TransferHistoryEntry` (`lib.rs:489,531`; `types.rs:146,157`), but no code path performs any token transfer/`require_auth` for payment (zero token-client usage in the contract). The fee is purely decorative: the UI can display a fee that is never collected, and issuers relying on it lose revenue while users believe they paid. Fix: integrate a SAC token transfer in `complete_transfer` gated on `transfer_fee > 0`, or remove the field until fee handling exists.

---

**Title:** `initiate_transfer` emits no event and there is no `TransferInitiated` event type
**Labels:** `enhancement` `contract`
**Body:** `accept_transfer` and `complete_transfer` publish events, but `initiate_transfer` (`lib.rs:482-555`) writes the pending transfer, index, and history with no `env.events().publish(...)`, and `types.rs:108-122` defines no `TransferInitiatedEvent`. The intended new owner (`to_owner`) and off-chain indexers therefore have no on-chain signal that a transfer is awaiting acceptance, breaking the notification flow. Fix: add and publish a `TransferInitiatedEvent { transfer_id, certificate_id, from_owner, to_owner }`.

---

**Title:** Several state-changing functions emit no events (`update_certificate_metadata`, `set_certificate_expiry`, `add_issuer`, `remove_issuer`)
**Labels:** `enhancement` `contract`
**Body:** Four mutating entry points (`lib.rs:379-396,1252-1272,74-100,127-163`) change on-chain state with no event emission, so the backend webhook/indexer layer cannot react to metadata edits, expiry changes, or issuer allow-list changes. Fix: define and publish `CertificateMetadataUpdatedEvent`, `CertificateExpirySetEvent`, `IssuerAddedEvent`, and `IssuerRemovedEvent`.

---

**Title:** `reissue_certificate` reuses the `"issued"` event topic — indexers cannot distinguish a reissue from a fresh issuance
**Labels:** `enhancement` `contract`
**Body:** Both `issue_certificate` (`lib.rs:223-224`) and `reissue_certificate` (`lib.rs:468-469`) publish under `symbol_short!("issued")`. A reissue (which supersedes a parent and carries `parent_certificate_id`) is indistinguishable on-chain from an original issuance, so downstream consumers double-count issuance metrics and never learn a supersede occurred. Fix: emit a distinct `"reissued"` topic carrying the `old_id`/`parent` linkage.

---

**Title:** `get_transfer` (and public transfer views) return full records to anyone with no authorization
**Labels:** `security` `contract`
**Body:** `get_transfer`, `get_transfer_history_public`, and `get_pending_transfers_public` (`lib.rs:783-796`) read and return transfer details (owner addresses, fees, memos) with no `require_auth` and no participant check — unlike the hardened `get_pending_request` (`lib.rs:1080-1104`). Any observer can enumerate every pending transfer, its parties, and free-text memos. Fix: mirror the `get_pending_request` authorization pattern (restrict to `from_owner`/`to_owner`/admin), or explicitly document these as intentionally public.

---

**Title:** Large volume of orphaned, partially non-compiling contract source is committed but never in the module tree
**Labels:** `tech-debt` `contract`
**Body:** `lib.rs` declares only `types, multisig, crl, persistent, storage, admin_multisig` (+ test mods); none of `shadow.rs`, `metadata.rs`, `storage_helpers.rs`, `certificate/`, `request/`, or `request_status/` are declared as modules, so those "features" are dead and unreachable. Worse, `storage_helpers.rs:5-21` calls `env.storage().set(...)`/`.get(...)` (methods that don't exist on Soroban SDK 27 `Storage`) and uses `Vec` without importing it, so it wouldn't compile if wired in. Fix: delete the orphaned files or actually wire and repair them; non-compiling dead code invites accidental inclusion.

---

**Title:** Several contract test files are not wired into the crate — reported "tests" never run
**Labels:** `tech-debt` `contract`
**Body:** Only `admin_multisig_test`, `crl_test`, `issuer_test`, `multisig_test`, and `status_test` are declared under `#[cfg(test)]` in `lib.rs:41-50`. The remaining `*_test.rs` files (`comprehensive_tests.rs`, `test.rs`, `test_backend.rs`, `metadata_test.rs`, `issuer_management_test.rs`) are never compiled or run, and `test/CertificateManager.test.ts` is a stray TypeScript file inside the Rust crate — creating a false impression of coverage (`cargo test` skips them). Fix: declare the intended test modules (fixing any that reference dead code), and move/remove the TS file.

---

# Run-Verification Pass — 2026-09-25

**What was executed on this pass** (branch `main`, already up to date with `origin/main` at `09c83a86`):

| Check                                 | Result                                             |
| ------------------------------------- | -------------------------------------------------- |
| `npm install` (from committed lock)   | ✅ installs, but see blockers below                |
| `npm install` (clean, no lock)        | ❌ **failed** — ERESOLVE peer conflicts            |
| Backend `tsc --noEmit`                | ❌ 28 errors → ✅ 4 errors after fix (spec-only)   |
| Backend boot (`nest start`)           | ❌ would not compile → ✅ **starts, port 3000**    |
| `GET /api/v1/health`                  | ✅ 200                                             |
| `GET /api/docs` (Swagger)             | ✅ 200                                             |
| Frontend `tsc -b`                     | ✅ clean                                           |
| Frontend `vite build`                 | ✅ built in 8.4 s                                  |
| Frontend dev server                   | ✅ port 5173                                       |
| Backend `jest`                        | ✅ 259 passed / 25 suites                          |
| Frontend `vitest`                     | ✅ 77 passed / 16 files                            |
| Contracts `cargo check --all-targets` | ✅ compiles (43 deprecation warnings)              |
| Contracts `cargo test`                | ✅ 44 passed                                       |
| `npm audit`                           | ⚠️ 18 vulns (13 high) → 9 vulns (6 high) after fix |

**Environment note:** the backend needs Postgres and Redis. Neither is started by any repo script — they were provisioned manually (`postgres:16-alpine` on 5432, `redis:7-alpine` on 6379). The backend also only creates its schema with `TYPEORM_SYNCHRONIZE=true`; see the migration issues below.

**Three fixes were applied to make the app start** (`package.json`, `frontend/package.json`) — filed below as RESOLVED for traceability.

**Tracker audit.** Every pre-existing issue was re-checked against the code on this date. 49 entries were
verified as already fixed and removed: 43 individual issues plus the 6-issue "Build Blockers" section that
was already marked resolved. The tracker went from 184 entries to 135. Entries were deleted only on positive
evidence of a fix; anything that could not be confirmed either way was kept.

---

## Infrastructure / Build (third batch)

---

**Title:** RESOLVED — Duplicate `rxjs` copies broke the backend build entirely (28 TS errors, app could not start)
**Labels:** `bug` `build-blocker` `backend` `resolved`
**Body:** `@angular-devkit/core` (pulled in by the `@nestjs/cli` devDependency) pins `rxjs` to exactly `7.8.1`, so npm nested that copy at `backend/node_modules/rxjs` while hoisting `7.8.2` to the workspace root. Backend source therefore resolved `rxjs` → 7.8.1 while `@nestjs/common` resolved → 7.8.2, giving two distinct nominal type identities. Every interceptor failed with `TS2416`/`TS2322` (`Property 'isStopped' is protected but type 'Subscriber<T>' is not a class derived from 'Subscriber<T>'`) — 28 errors across `cache.interceptor.ts`, `security/interceptor.ts` and others, so `nest start` never produced a running app. `npm ls rxjs` confirmed the committed lockfile was _invalid_: it placed 7.8.1 inside `backend/` despite `backend/package.json` declaring `^7.8.2` (`rxjs@7.8.1 deduped invalid: "^7.8.2" from backend`). **Fix applied:** added `"overrides": { "rxjs": "^7.8.2" }` to the root `package.json`, collapsing the tree to a single hoisted copy. Backend now compiles with 0 errors and boots.

---

**Title:** RESOLVED — A clean `npm install` (no lockfile) fails: `@vitejs/plugin-react@4` does not support Vite 8
**Labels:** `bug` `build-blocker` `frontend` `resolved`
**Body:** `frontend/package.json` declared `vite@^8.2.2` alongside `@vitejs/plugin-react@^4.3.4`, whose peer range is `vite@^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0`. Installing from the committed lockfile masked this, but any from-scratch `npm install` (a fresh clone with no lock, or CI running `npm ci` after a lock refresh) aborted with `ERESOLVE could not resolve`. The mismatch also produced deprecation warnings on every dev-server start (`esbuild` option was specified by "vite:react-babel" plugin…, `optimizeDeps.esbuildOptions` … now deprecated). **Fix applied:** bumped to `@vitejs/plugin-react@^5.2.0`, whose peer range is `^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0`. It stays Babel-based (v6 switches to oxc), so no config change was needed; the deprecation warnings are gone and `vite build` and all 77 vitest tests pass. Consider `@vitejs/plugin-react@6` as a separate, deliberate migration.

---

**Title:** RESOLVED — `eslint-plugin-react-refresh` was an unused dependency with an unsatisfiable peer range
**Labels:** `bug` `tech-debt` `frontend` `resolved`
**Body:** `frontend/package.json` declared `eslint-plugin-react-refresh@^0.5.5`, but **every** `0.5.x` release requires `eslint@^9 || ^10` while the repo pins `eslint@^8.57.1` (only `0.4.x` supports eslint 8). This was the second `ERESOLVE` blocker on a clean install. The plugin is also referenced _nowhere_: `.eslintrc.cjs` does not list it under `plugins` or `extends` — a comment there explains the React Refresh rule is intentionally disabled. **Fix applied:** removed the dependency. If the rule is ever wanted back, it requires the ESLint 9 flat-config migration first (see next issue).

---

**Title:** Frontend is pinned to ESLint 8, which is end-of-life and blocks the modern plugin ecosystem
**Labels:** `enhancement` `tech-debt` `frontend`
**Body:** `frontend/package.json` pins `eslint@^8.57.1` (npm itself warns `eslint@8.57.1: This version is no longer supported`) with a legacy `.eslintrc.cjs`. This is what makes current plugin versions uninstallable — `eslint-plugin-react-refresh@0.5.x` needs ESLint 9+, and `@typescript-eslint` is held back at v7 for the same reason. Fix: migrate to ESLint 9 with flat config (`eslint.config.js`), bump `@typescript-eslint/*` to v8, and re-add `eslint-plugin-react-refresh` if the HMR rule is wanted.

---

**Title:** `puppeteer` is declared as a root dependency but used nowhere — and causes 4 of the 6 remaining high-severity advisories
**Labels:** `security` `tech-debt` `infrastructure`
**Body:** `puppeteer@^24.42.0` is listed in the root `package.json` dependencies. A repo-wide search (excluding `node_modules` and the lockfile) finds exactly one reference: **the declaration itself**. Nothing in `backend/src` or `frontend/src` imports it. It nonetheless installs Chromium on every `npm install` and contributes `puppeteer`, `puppeteer-core`, `@puppeteer/browsers` and `extract-zip` (unvalidated symlink path traversal / arbitrary file write) to the audit report — 4 of the 6 high-severity advisories that remain after the rxjs fix. Removing it would cut high-severity findings from 6 to 2. Fix: delete the dependency, or move it to `backend` devDependencies if PDF generation is genuinely planned.

---

**Title:** Root `package.json` duplicates backend runtime dependencies at _different_ version ranges
**Labels:** `bug` `infrastructure`
**Body:** The root manifest is a workspace manager but declares five backend runtime dependencies that `backend/package.json` also declares — at ranges that do not match: `bull` (root `^4.16.5` vs backend `^4.15.1`) and `handlebars` (root `^4.7.9` vs backend `^4.7.8`); `@nestjs/bull`, `@nestjs/platform-express` and `nodemailer` are duplicated at matching ranges. Divergent ranges for the same package across a workspace are exactly what pushes npm into nesting a second copy inside `backend/node_modules` — the same class of failure that produced the rxjs build blocker above. Fix: remove all five from the root manifest and let `backend/package.json` own them.

---

**Title:** `shared` is declared as an npm workspace but the directory does not exist
**Labels:** `bug` `infrastructure`
**Body:** Root `package.json` declares `"workspaces": ["frontend", "backend", "shared"]`, but there is no `shared/` directory in the repository. npm tolerates the dangling entry today, but it is dead configuration that misleads contributors into expecting a shared types/util package (and any tooling that enumerates workspaces will resolve one fewer than declared). Fix: create `shared/` if a shared package is intended — it would be a natural home for the API types currently duplicated between `frontend/src/api/types.ts` and the backend DTOs — otherwise drop the entry.

---

**Title:** No script or compose target starts the Postgres/Redis the backend requires
**Labels:** `enhancement` `infrastructure` `dx`
**Body:** `npm run dev` runs `nest start --watch` and `vite` concurrently, but the backend needs Postgres on 5432 and Redis on 6379 and neither is started by any script. `docker-compose.yml` builds the full application images rather than offering a dependencies-only target, so a contributor wanting the fast local loop (`npm run dev`) must hand-provision both containers — this pass did so manually. Fix: add a `docker-compose.dev.yml` (or a `services` profile) containing only Postgres + Redis, plus an `npm run dev:deps` script, and reference it from `CONTRIBUTING.md`.

---

**Title:** `npm audit` reports 9 vulnerabilities (6 high) and there is no CI gate on them
**Labels:** `security` `infrastructure`
**Body:** After the dependency fixes on this pass the tree reports 9 advisories, 6 of them high: 4 via the unused `puppeteer` (above), and `@stellar/stellar-sdk` → `toml` (`toml-node: Uncontrolled Recursion`; `Prototype Pollution Leads to Object.prototype Corruption`). The root manifest defines a `security:audit` script but nothing in `.github/workflows` runs it, so the count drifts silently. Fix: drop `puppeteer`, bump `@stellar/stellar-sdk` to a release that ships a patched `toml`, and add `npm audit --audit-level=high` as a CI step.

---

## Backend (third batch)

---

**Title:** `MultisigModule` is never imported into `AppModule` — the entire multisig feature is unreachable dead code
**Labels:** `bug` `backend`
**Body:** `backend/src/modules/multisig/` defines `MultisigModule`, `MultisigController` and `MultisigService`, but `app.module.ts` imports 18 modules and `MultisigModule` is not among them. Grepping the whole of `backend/src` for `MultisigModule` returns exactly one hit — its own `export class` declaration in `multisig.module.ts`. Nest therefore never instantiates it, no multisig route is registered, and none of the endpoints exist at runtime (confirmed on this pass: the app boots and serves no multisig path). This materially changes the reading of the several multisig defects already filed in earlier batches — the DTO-constructor bug, the un-polled `getTransaction` calls, the hardcoded mock return values — all sit in code that is not wired up. Fix: either add `MultisigModule` to the `AppModule` imports and then resolve the outstanding multisig bugs before exposing it, or delete the module until the feature is ready.

---

**Title:** Three orphaned top-level directories shadow real modules and are imported by nothing
**Labels:** `tech-debt` `backend`
**Body:** `backend/src/` contains `email/`, `metadata-schema/` and `security/` as siblings of `modules/`, each duplicating the name of a real module under `modules/`. None of them is referenced anywhere: `src/email/email.service.ts` and `src/email/template-version.service.ts`, `src/metadata-schema/{metadata-schema.controller,metadata-schema.service}.ts`, and `src/security/{auth-throttler.module,throttler-config}.ts` have zero importers (every `metadata-schema` import in the tree resolves to `modules/metadata-schema/`). They are stale copies that predate the move into `modules/`, and their existence makes `src/security/…` vs `modules/security/…` ambiguous when reading imports or grepping. Fix: delete all three directories.

---

**Title:** `GET /health` omits the database indicator — reports `ok` while Postgres is unreachable
**Labels:** `bug` `backend`
**Body:** `HealthController` injects `DatabaseHealthIndicator` ([health.controller.ts:16](backend/src/modules/health/health.controller.ts#L16)) and uses it in `readiness()` ([:72](backend/src/modules/health/health.controller.ts#L72)) and `databaseCheck()` ([:125](backend/src/modules/health/health.controller.ts#L125)) — but the primary `check()` handler calls only `stellarHealth` and `redisHealth` ([:35-37](backend/src/modules/health/health.controller.ts#L35-L37)). Verified at runtime: `GET /api/v1/health` returned `{"status":"ok","info":{"stellar":…,"redis":…}}` with no `database` key. Since `/health` is the conventional endpoint for load balancers and uptime monitors, an instance that has lost its database connection still advertises itself as healthy and keeps receiving traffic. Fix: add `() => this.databaseHealth.isHealthy()` to `check()`.

---

**Title:** Legacy `forRoutes('*')` wildcards emit five deprecation warnings on every boot and rely on auto-conversion
**Labels:** `tech-debt` `backend`
**Body:** Three modules register middleware with the pre-Nest-11 wildcard syntax: [common.module.ts:142](backend/src/common/common.module.ts#L142) (`CorrelationIdMiddleware`, `MetricsMiddleware`), [audit.module.ts:28](backend/src/modules/audit/audit.module.ts#L28) (`AuditContextMiddleware`) and [security.module.ts:32](backend/src/modules/security/security.module.ts#L32) (`{ path: '*', method: RequestMethod.ALL }`). `path-to-regexp` v8 no longer accepts a bare `*`, so every startup logs five `WARN [LegacyRouteConverter] Unsupported route path: "/api/*"… Attempting to auto-convert to "/api/{*path}"` lines. The auto-conversion is an explicitly temporary shim. Fix: change each to the named form `'{*path}'` (e.g. `.forRoutes({ path: '{*path}', method: RequestMethod.ALL })`).

---

**Title:** `ssrf.utils.spec.ts` fails typecheck — `npm run typecheck:backend` and `ci:check` are red
**Labels:** `bug` `tech-debt` `backend`
**Body:** With the rxjs duplication fixed, `tsc --noEmit` in `backend/` still reports 4 errors, all `TS2349: This expression is not callable. Type 'ResolveOptions' has no call signatures.` at [ssrf.utils.spec.ts:15,18,24,27](backend/src/common/utils/ssrf.utils.spec.ts#L15). `dns.resolve4`/`resolve6` are overloaded, and `jest.MockedFunction<typeof dns.resolve4>` collapses to the `(hostname, options)` overload, so the `(_hostname, cb) => cb(null, ipv4)` mock implementations are typed against `ResolveOptions` instead of a callback. The tests themselves pass (`jest` is transpile-only and `tsconfig.build.json` excludes `**/*spec.ts`, which is why the app still builds and boots) — but `npm run typecheck` and therefore `npm run ci:check` fail. Fix: type the mocks against the callback overload explicitly, e.g. `jest.fn() as unknown as jest.MockedFunction<(h: string, cb: (e: Error | null, a: string[]) => void) => void>`.

---

**Title:** Ethereal SMTP credentials are written to the application log in plaintext
**Labels:** `security` `backend`
**Body:** When no mail credentials are configured, `EmailService` provisions an Ethereal test account and logs it verbatim: `` `Ethereal test account: ${testAccount.user} / ${testAccount.pass}` `` at [email.service.ts:83](backend/src/modules/email/email.service.ts#L83), at `LOG` level. Observed on this pass in the startup output. Although Ethereal is a throwaway dev mailbox, this is a credential pair going to stdout and into whatever log aggregator collects it, and the surrounding fallback has no environment guard — any deployment that starts without SMTP settings will do the same. Fix: log only the account name (or the preview URL), and gate the message behind `NODE_ENV === 'development'`.

---

**Title:** No initial-schema migration exists — a fresh database cannot be provisioned by migrations at all
**Labels:** `bug` `backend`
**Body:** Distinct from the already-filed wrong-glob issue: even with the `migrations` path corrected, there is nothing to create the schema. `backend/src/database/migrations/` contains exactly one file, `1780272000000-AddPasswordResetLookupAndRecipientName.ts`, and its `up()` runs `ALTER TABLE "users" ADD COLUMN …` and `ALTER TABLE "certificates" ADD COLUMN …` — it assumes both tables already exist. There are 12 `*.entity.ts` files and no migration that creates any of them. On this pass a fresh Postgres produced zero tables until the app was started with `TYPEORM_SYNCHRONIZE=true`, which then created 13. Fix: generate and commit a baseline `InitialSchema` migration (`npm run migration:generate`) so `migration:run` can provision an empty database, making `synchronize` unnecessary outside local development.

---

**Title:** `pg` deprecation warning on startup — concurrent `client.query()` on a single client
**Labels:** `tech-debt` `backend`
**Body:** Boot emits `DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.` The warning fires during TypeORM's schema step, indicating queries are being issued on a client that has one in flight — behaviour that becomes a hard error in `pg@9`. Fix: run with `node --trace-deprecation` to identify the call site, and ensure the offending path awaits each query (or uses a pool client per logical operation) before `pg` is upgraded.

---

## Frontend (third batch)

---

**Title:** `vite.config.ts` uses `__dirname`, which the native config loader cannot support
**Labels:** `tech-debt` `frontend`
**Body:** `frontend/package.json` sets `"type": "module"`, and [vite.config.ts:9](frontend/vite.config.ts#L9) resolves the `@` alias with `path.resolve(__dirname, 'src')`. Vite 8 warns on every dev-server and build invocation: `Your Vite config uses features that are unsupported by configLoader: 'native', which is planned to become the default in a future major version of Vite: __dirname (vite.config.ts:9:25). Use import.meta.dirname instead.` When `configLoader: 'native'` becomes the default this stops being a warning. Fix: replace `__dirname` with `import.meta.dirname` (the `node:path` import is still needed for `resolve`).

---

**Title:** `api/endpoints.ts` is a single 1,533-line module holding the entire client API surface
**Labels:** `tech-debt` `frontend`
**Body:** [endpoints.ts](frontend/src/api/endpoints.ts) is 1,533 lines and imports 32 types from `./types`. It contains the fetch wrapper, the retry/backoff policy, the token-refresh de-duplication logic, the dummy-data switch, _and_ every endpoint group (auth, certificates, issuers, audit, analytics, notifications, transfers, webhooks, metadata schemas). Every feature touching any endpoint edits the same file, which makes conflicts routine and keeps the transport concerns entangled with the resource calls. Fix: keep the client/transport core in `api/client.ts` and split the resource groups into `api/resources/{auth,certificates,issuers,audit,analytics,notifications}.ts`, re-exported from `api/index.ts` so call sites do not change.

---

**Title:** No server-state caching layer — every page refetches on each mount
**Labels:** `enhancement` `frontend`
**Body:** The app has no data-fetching/caching library (no TanStack Query, SWR or RTK Query in `frontend/package.json`); components call `endpoints.ts` helpers directly from `useEffect`. Consequences visible in the code: no request de-duplication across sibling components, no background revalidation, no shared cache between routes, and hand-rolled loading/error state repeated in every page. The API layer already had to grow bespoke retry/backoff and refresh-coalescing logic ([endpoints.ts:88-110](frontend/src/api/endpoints.ts#L88-L110)) that a query library provides for free. Fix: adopt TanStack Query for server state and reduce `endpoints.ts` to plain fetchers.

---

**Title:** `AuthContext` keeps the access token in memory only — a page refresh always costs a refresh round-trip
**Labels:** `enhancement` `frontend`
**Body:** `tokenStorage` in [tokens.ts](frontend/src/api/tokens.ts) holds the access token in a module-level `_inMemoryAccessToken` with no persistence — a deliberate and correct XSS-hardening choice, since the refresh token is an HttpOnly cookie. The cost is that every full page load starts unauthenticated and must hit `/auth/refresh` before any protected data can load; the code already carries a de-duplication guard and a 10-second cooldown specifically because that endpoint is IP rate-limited and a page full of 401s would trip a 429 ([endpoints.ts:88-110](frontend/src/api/endpoints.ts#L88-L110)). This is a workaround for a missing bootstrap step, not a fix. Fix: have the app perform one explicit `/auth/refresh` during initial mount, gate route rendering on it, and let protected requests assume a valid token.

---

## Stellar Contracts (third batch)

---

**Title:** 14 uses of the deprecated `env.events().publish` API — soroban-sdk 27 wants `#[contractevent]`
**Labels:** `tech-debt` `contract`
**Body:** `cargo check` reports 14 instances of `use of deprecated method 'soroban_sdk::events::Events::publish': use the #[contractevent] macro on a contract event type` — 10 in [lib.rs](stellar-contracts/src/lib.rs) (lines 216, 240, 274, 297, 321, 344, 462, 578, 650, 672) and 4 in [admin_multisig.rs](stellar-contracts/src/admin_multisig.rs) (158, 205, 251, 377). The tuple-topic form these call sites use is untyped: topics and payload shapes are not checked at compile time, which is precisely why the SDK is moving to declared event types. Migrating also makes the event schema introspectable for the backend indexer. Fix: define `#[contractevent]` structs for each event and publish those; this pairs naturally with the already-filed issues about missing and ambiguous events (`TransferInitiated`, the reused `"issued"` topic).

---

**Title:** 29 uses of the deprecated `env.register_contract` in contract tests
**Labels:** `tech-debt` `contract`
**Body:** `cargo check --all-targets` reports 29 instances of `use of deprecated method 'soroban_sdk::Env::register_contract': use 'register'` across [multisig_test.rs](stellar-contracts/src/multisig_test.rs) (18), [issuer_test.rs](stellar-contracts/src/issuer_test.rs) (8) and [crl_test.rs](stellar-contracts/src/crl_test.rs) (2, plus one stub registration). All 44 tests pass, so this is purely forward-compatibility debt, but it is 29 of the crate's 43 total warnings — enough noise to hide a real warning. Fix: mechanically replace `env.register_contract(None, X)` with `env.register(X, ())`.

---

**Title:** The contract crate builds with 43 warnings and no `deny(warnings)` gate in CI
**Labels:** `tech-debt` `contract`
**Body:** `cargo check --all-targets` completes successfully but emits 43 warnings (the two deprecation families above account for all of them). Nothing in `.github/workflows` fails a build on warnings, and `npm run lint:contracts` runs `cargo clippy` without `-- -D warnings`, so the count can grow unnoticed and a genuinely new warning is easy to miss in the noise. Fix: clear the existing deprecations, then add `-- -D warnings` to the clippy step so regressions fail CI.

---
