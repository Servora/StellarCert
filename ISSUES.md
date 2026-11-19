# StellarCert Issue Tracker

This tracker was regenerated from a full audit of the current `main` branch
(commit `87fa210d`): a live Docker Compose run of the full stack, plus a
systematic read-through of the backend (NestJS), frontend (React), and smart
contracts (Soroban/Rust). Earlier entries in this file have been superseded —
many prior findings are already fixed (verified against `IMPLEMENTATION_NOTES.md`
and the current source) and have been dropped rather than re-listed.

---

## Critical — found by actually running the stack

These two were not visible from reading the code in isolation — they only
surfaced when the full `docker-compose up` stack was actually started and
driven end to end. Both were root-caused and fixed in this pass (see the
corresponding commit); they're listed here so the fix and its rationale stay
documented.

---

**Title:** `BullModule.forRootAsync`'s `{ redis: { url: redisUrl } }` is silently ignored — every BullMQ-backed feature connects to the wrong Redis with no auth and hangs forever
**Labels:** `bug` `backend` `critical`
**Body:** `app.module.ts`'s `BullModule.forRootAsync` factory returned `{ redis: { url: redisUrl } }` when `REDIS_URL` is set. `bull@4.15.1` passes this object straight into `new Redis(config)` (confirmed by reading `node_modules/bull/lib/queue.js`), and ioredis's `RedisOptions` type has no `url` key — it silently ignores the unrecognized property and falls back to its defaults (`127.0.0.1:6379`, no password). Inside `docker-compose`, nothing listens on the backend container's own loopback port 6379, so every Bull Redis client (email queue, webhook queue, the `RedisHealthIndicator`) sits forever in ioredis's default-infinite retry/offline-command-queue behavior — the command never resolves or rejects. This was reproduced live: `GET /api/v1/health` and `/api/v1/health/redis` hung for exactly 30 seconds (the global request-timeout) and returned 408 on every single call, meaning the Docker healthcheck the compose file depends on (`condition: service_healthy`) can never pass, which in turn means `frontend` (which waits on `backend: service_healthy`) never starts under `docker compose up` — the documented quick-start is broken end to end for anyone exercising BullMQ-backed features. **Fixed** in this pass: the factory now parses `REDIS_URL` with `new URL(...)` and passes explicit `host`/`port`/`password` fields instead of a raw `url` key.

---

**Title:** Four shipped shell scripts have CRLF line endings, breaking the backend Docker image on any Windows checkout
**Labels:** `bug` `devops` `critical`
**Body:** `backend/docker-entrypoint.sh`, `deploy-contracts.sh`, `stellar-contracts/build-contracts.sh`, and `.husky/pre-commit` all checked out with CRLF line terminators on a Windows machine with `core.autocrlf=true` (the Git default for Windows) and no repo-level override. There is no `.gitattributes` forcing `*.sh` (or the extensionless entrypoint) to LF, so the shebang baked into the Docker image's `COPY docker-entrypoint.sh` becomes the literal string `#!/bin/sh\r`, which the Linux container can't resolve. This was reproduced live: `docker compose up --build` produced a backend container that printed `exec ./docker-entrypoint.sh: no such file or directory` in an infinite restart loop, for every single container start, with the only hint being a POSIX-specific error message — this fully blocks the backend from booting at all for any contributor on Windows, which is a supported OS per `CLAUDE.md`'s "PowerShell (primary)" environment and the many Windows-specific instructions in this project's tooling. **Fixed** in this pass by normalizing the four files' line endings to LF; add a `.gitattributes` with `*.sh text eol=lf` (and the same for `docker-entrypoint.sh` specifically, since it has no extension) to prevent recurrence regardless of a contributor's local `core.autocrlf` setting.

---

## Backend

---

**Title:** `CertificateExpirationJob` Stellar-sequence expiration check marks certificates expired after any unrelated issuer transaction
**Labels:** `bug` `backend`
**Body:** In `certificate-expiration.job.ts`, the sequence-based branch fetches the issuer account's *current* sequence number and expires every active certificate whose stored `stellarSequenceNumber` is lower (`currentSequence > certSequence`). The issuer account's sequence number increments on every transaction that account submits — not per certificate — so the moment the issuer signs one more Stellar transaction (issuing or revoking any other certificate), every previously issued certificate with a stored sequence number becomes `currentSequence > certSequence` and gets mass-expired on the next hourly run. This can wipe out the active status of an entire issuer's certificate catalog. Either drop this expiration path or key it off something that doesn't change per-transaction (e.g. a stored expiry ledger close time).

---

**Title:** Certificate expiration never fires `CERTIFICATE_EXPIRED` webhook or notifies the recipient
**Labels:** `bug` `backend`
**Body:** `WebhookEvent.CERTIFICATE_EXPIRED` is defined in `webhook-subscription.entity.ts` but `certificate-expiration.job.ts` never calls `webhooksService.triggerEvent` for either the date-based or sequence-based path, and no email/notification is sent to the certificate recipient the way transfers and revocations do. Issuers who built integrations around the expiry webhook never receive it; the event type is effectively dead code.

---

**Title:** `CertificateExpirationJob` does per-row `save()` in an unbounded in-memory loop
**Labels:** `enhancement` `backend`
**Body:** The hourly cron loads all active certificates past their `expiresAt` with an unbatched `getMany()` and then issues one `UPDATE` per row sequentially. On an issuer with tens of thousands of certificates this both pulls a huge result set into memory every run and serializes thousands of round-trips. Replace with a single `UPDATE certificates SET status = 'expired' WHERE status = 'active' AND expiresAt <= now()` (plus a bulk audit-log entry) and keep the per-row path only for the Stellar-sequence case.

---

**Title:** `WebhookSubscription.secretHash` is written on create but never read anywhere
**Labels:** `tech-debt` `backend`
**Body:** `WebhooksService.createSubscription` computes a `sha256` hash of the signing secret and persists it to `secretHash`, but no code path in `webhooks.service.ts`, `webhooks.controller.ts`, or `webhooks.processor.ts` ever reads it back. It's a write-only column that adds migration/storage overhead for no behavior. Either use it to let operators verify a client's stored secret without re-exposing the plaintext, or remove the column.

---

**Title:** No endpoint to rotate a webhook subscription's secret
**Labels:** `enhancement` `backend`
**Body:** `WebhooksController` only supports create/list/delete/test — there is no `PATCH`/rotate action. If a signing secret leaks, the only remediation is deleting the subscription and recreating it, which also discards its `WebhookLog` delivery history (logs are keyed by `subscriptionId` with no retention on the old row). Add a `POST /webhooks/:id/rotate-secret` endpoint that reissues the secret in place.

---

**Title:** Webhook delivery is vulnerable to DNS-rebinding between SSRF validation and dispatch
**Labels:** `security` `backend`
**Body:** `WebhooksProcessor.handleDelivery` calls `validateWebhookUrl(subscription.url)` and then, as a separate step, has `axios` perform its own DNS resolution and connection. An attacker-controlled hostname can resolve to a public IP during validation and to an internal/link-local address (e.g. `169.254.169.254`) a few milliseconds later when `axios.post` actually connects, bypassing the SSRF guard entirely. The fix needs to pin the resolved IP from validation and use it for the actual request (e.g. via a custom `lookup`/agent), not just re-validate the string URL.

---

**Title:** On-chain-driven certificate state changes bypass the audit log entirely
**Labels:** `bug` `backend`
**Body:** `ContractEventIndexerService.applyIssued/applyRevoked/applyFrozen/applyUnfrozen/applyTransferDone` mutate `Certificate` rows and fire webhooks when chain events are observed, but none of them call `AuditService.log(...)`. Every other path that changes certificate status (revocation service, transfer service, freeze endpoint) writes an audit entry, so status changes originating on-chain are invisible in the compliance audit trail.

---

**Title:** `ContractEventIndexerService.applyTransferDone` can complete the wrong pending transfer
**Labels:** `bug` `backend`
**Body:** In `contract-event-indexer.service.ts`, `applyTransferDone` marks *any* `TransferStatus.PENDING` row for the certificate as `APPROVED` without checking that its `toEmail`/intended owner matches the on-chain `to_owner`. If a certificate has more than one transfer request pending (e.g. a rejected-then-reinitiated flow, or a race between two issuers), an unrelated pending transfer gets silently marked approved. It also never sets `completedAt`, leaving the row inconsistent with transfers approved through `CertificateTransferService`.

---

**Title:** Chain-synced certificate status changes never notify the recipient or issuer
**Labels:** `enhancement` `backend`
**Body:** Off-chain revoke/freeze/unfreeze flows send emails via `EmailService` in addition to webhooks, but `ContractEventIndexerService`'s equivalents only call `webhooksService.triggerEvent`. A certificate revoked directly on-chain (bypassing the API) never emails the recipient, creating an inconsistent UX depending on which path triggered the change.

---

**Title:** `ContractEventIndexerService.syncOnce` never persists a cursor while there are zero new events
**Labels:** `tech-debt` `backend`
**Body:** When `result.events` is empty and `result.cursor` is also falsy (the common steady-state case once fully caught up), `next` evaluates to the existing (possibly still-undefined) `cursor` and the `if (next)` guard skips the save. On every restart with no cursor row yet, the indexer recomputes `startLedger` from `getLatestLedgerSequence()` from scratch instead of resuming. Add an explicit "mark polled at ledger X" cursor update so restarts don't silently re-derive the starting point.

---

**Title:** WebSocket notification connections are never re-validated after handshake
**Labels:** `security` `backend`
**Body:** `NotificationsGateway.handleConnection` checks the access token and user status once at connect time, then leaves the socket joined to `user_<id>` indefinitely. A user who is logged out (token blacklisted via `JwtManagementService.blacklistToken`) or suspended after connecting keeps receiving `newNotification` events on the open socket until they manually disconnect — session revocation doesn't propagate to realtime connections. Add periodic re-validation (e.g. an interval that re-checks blacklist/status, or a short-lived socket auth TTL that forces reconnect).

---

**Title:** 2FA brute-force lockout silently disables when `CACHE_MANAGER` isn't wired
**Labels:** `security` `backend`
**Body:** `TwoFactorService` takes `cacheManager` as `@Optional()`, and every lockout/attempt-counting branch in `validateLogin` is gated behind `if (this.cacheManager)`. If the cache provider isn't bound in some deployment profile, 2FA brute-force protection fails open with no warning log — unlimited TOTP/backup-code guesses are allowed. Make the dependency mandatory, or log a startup warning when it's absent the same way `StorageService` does for S3.

---

**Title:** No TOTP replay protection in `TwoFactorService.verifyToken`
**Labels:** `security` `backend`
**Body:** `verifyToken` only calls `authenticator.verify({ token, secret })`, which accepts the same valid code repeatedly within its 30-second window. There's no tracking of the last-consumed step per user, so a code captured via shoulder-surfing, logging, or a compromised proxy can be replayed a second time before it expires. Track the last accepted time-step per user (e.g. in the same cache store) and reject a repeat within the window.

---

**Title:** `DistributedLockService` locks have a fixed 30-minute TTL and no renewal/heartbeat
**Labels:** `tech-debt` `backend`
**Body:** `LOCK_TTL_MS = 30 * 60 * 1000` in `distributed-lock.service.ts` is a single fixed timeout with no way to extend it while the holder is still working and no heartbeat to detect a crashed holder early. A long-running bulk-issuance or cleanup job that holds the lock past 30 minutes loses it mid-operation, while a holder that crashes 30 seconds in blocks the resource for the full 30 minutes regardless. Add a `renew(key, token)` call on a heartbeat interval and shorten the base TTL.

---

**Title:** `DuplicateDetectionService` override IDs generated with `Math.random()`
**Labels:** `tech-debt` `backend`
**Body:** `duplicate-detection.service.ts:354` builds override IDs as `` `override_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` ``. `Math.random()` is not collision-resistant and `substr` is deprecated; under concurrent requests in the same millisecond the random suffix is the only entropy. Use `crypto.randomUUID()` like the rest of the codebase (`randomUUID` is already used in `distributed-lock.service.ts` and `storage.service.ts`).

---

**Title:** ReDoS heuristic in `assertSafePattern` only catches nested-quantifier patterns
**Labels:** `security` `backend`
**Body:** `metadata-schema.service.ts`'s `assertSafePattern` rejects an explicit nested-quantifier shape (`(a+)+`) but still compiles and later executes, with no timeout, patterns with exponential/polynomial backtracking that don't match that shape — e.g. alternation-based blowups (`(a|a)*b`). A malicious or careless issuer-defined metadata schema pattern can still cause a worker-thread-blocking regex hang when end users submit crafted metadata values. Wrap pattern execution in a time-boxed worker or switch to a linear-time engine (e.g. `re2`) instead of relying purely on shape heuristics.

---

**Title:** Webhook test endpoint has no rate limit — issuer can flood arbitrary URLs
**Labels:** `security` `backend`
**Body:** `WebhooksController.test` (`POST /webhooks/test`) queues a real HTTP delivery to the subscription's stored URL with no per-issuer or per-URL rate limiting. An issuer (or anyone who compromises an issuer account) can repeatedly call this endpoint to use the backend as a traffic generator against any URL that passed SSRF validation at subscription-creation time. Apply the same guard used on other sensitive write endpoints.

---

**Title:** Webhook retry backoff can compound into unbounded delivery latency with no dead-letter visibility
**Labels:** `enhancement` `backend`
**Body:** `triggerEventForSubscription` configures `attempts: 5` with a custom `webhookRetry` backoff but there's no surfaced "final failure" state — after all 5 attempts are exhausted, Bull just drops the job and nothing updates `WebhookSubscription.isActive` or notifies the issuer that their endpoint has been consistently failing. Add a dead-letter log entry and auto-pause (with issuer notification) after N consecutive failures.

---

**Title:** Confirmation-code flows have no IP-based throttling on top of attempt counting
**Labels:** `security` `backend`
**Body:** `CertificateTransferService.approveTransfer` counts wrong-code attempts per transfer (good), but there's no per-IP or per-account rate limit on how fast those attempts can be submitted — `MAX_CONFIRMATION_CODE_ATTEMPTS = 5` can be exhausted in a tight loop within milliseconds. Pair the existing lockout with the shared `RateLimitStore`/`IpRateLimitGuard` so repeated guesses are throttled in time, not just counted.

---

**Title:** `AuditLog` writes in background jobs use fire-and-forget `void` calls that can silently drop entries
**Labels:** `tech-debt` `backend`
**Body:** `CertificateExpirationJob` calls `void this.auditService.log(...)` for job-start/job-complete/per-certificate entries. If `AuditService.log` rejects (DB hiccup, pool exhaustion), the rejection is unhandled — no `.catch`, no retry. Either `await` these calls inside the existing try/catch or attach an explicit `.catch(err => this.logger.error(...))`.

---

**Title:** `IpRateLimitGuard`'s per-instance `mirror` Map has unbounded worst-case growth between prune cycles
**Labels:** `tech-debt` `backend`
**Body:** `pruneMirror` only runs once per request, after the entry is already inserted, and only removes entries whose `resetTime` has passed — under a distributed flood from many unique IPs within a single rate-limit window, `mirror` can grow to one entry per attacking IP before any expire. Since `mirror` only backs the monitoring endpoints (the authoritative limiter is correctly Redis-backed), the risk is monitoring-endpoint memory growth, but it should still have a hard size cap with LRU eviction.

---

**Title:** No endpoint to revoke a single session/device — only full logout via token blacklist
**Labels:** `enhancement` `backend`
**Body:** `AuthSession` entity and `SessionsService` exist (`modules/auth/services/sessions.service.ts`) but there's no user-facing "view my active sessions / sign out this device" flow exposed from `auth.controller.ts`. Users who suspect account compromise (e.g. after a shared computer) can't selectively terminate one session without changing their password, which forces every other device to re-login too.

---

**Title:** `recordFailed2faAttempt` and `blacklistToken` key the cache by raw token value, not token ID
**Labels:** `tech-debt` `backend`
**Body:** `jwt.service.ts` stores blacklist/attempt entries under keys like `` `blacklisted_token:${token}` `` — the full JWT string becomes the Redis/cache key. This works, but every login/refresh adds a new, large, unbounded-length key rather than a fixed-size identifier, and the cache backend ends up holding live (if blacklisted) bearer tokens verbatim. Sign tokens with a `jti` claim and key the cache by `jti` instead.

---

**Title:** No admin/issuer UI or API to list and manage webhook delivery failures across all subscriptions
**Labels:** `enhancement` `backend`
**Body:** `WebhookLog` records every delivery attempt with `isSuccess`, but the only read path is `GET /webhooks/:id/logs` scoped to one subscription. There's no aggregate endpoint (e.g. for the admin-analytics module) showing issuers or admins which subscriptions are currently failing across the board, so a broken integration can go unnoticed until an issuer manually checks each subscription's logs.

---

**Title:** Cleanup/audit jobs hand-write their own `DistributedLockService` key strings with no shared naming convention
**Labels:** `tech-debt` `backend`
**Body:** `cleanup.service.ts` and `audit-cleanup.job.ts` both depend on `DistributedLockService`, but each caller hand-writes its own lock key string with no shared constant or namespacing convention. As more jobs adopt the service, a naming collision between two unrelated jobs would make them serialize unnecessarily for the full 30-minute lock TTL.

---

**Title:** `StorageService` falls back to `us-east-1` without validating it matches the configured endpoint
**Labels:** `tech-debt` `backend`
**Body:** `storage.service.ts` defaults `region` to `'us-east-1'` whenever `STORAGE_REGION` is unset, even when a custom `STORAGE_ENDPOINT` (e.g. a MinIO instance in a different region, or a non-AWS S3-compatible provider) is configured. Some S3-compatible providers validate the region against the endpoint and reject requests with a mismatched default; the fallback should be conditional on no custom endpoint being set, or required alongside `STORAGE_ENDPOINT`.

---

**Title:** Old profile-picture objects are never deleted from storage on overwrite
**Labels:** `tech-debt` `backend`
**Body:** `StorageService.deleteFile` exists but has no caller from the profile-picture upload flow (no `deleteFile` call from `users.controller.ts`), so overwriting a picture leaves the previous S3/MinIO object in place indefinitely — a storage-cost and orphaned-data leak with no cleanup job analogous to `cleanup.service.ts` for certificate files.

---

**Title:** No structured outbox/retry for `WebhooksService.triggerEvent` failures when Bull/Redis is unavailable
**Labels:** `bug` `backend`
**Body:** `triggerEvent` and `triggerEventForSubscription` call `this.webhookQueue.add(...)` with no try/catch. If Redis (the Bull backing store) is briefly unavailable, `.add()` rejects and propagates up through the calling service (e.g. certificate issuance), potentially failing the *primary* operation just because the secondary webhook side-effect couldn't be queued. Webhook dispatch should be best-effort and never able to fail the request that triggered it; wrap the `.add()` call and log+continue on error.

---

**Title:** Transfer confirmation-code emails have no retry queue for transient SMTP errors
**Labels:** `enhancement` `backend`
**Body:** `CertificateTransferService.initiateTransfer`/`approveTransfer` wrap `emailService.send...` calls in try/catch and merely log a warning on failure — the confirmation-code email (the only way the new owner learns the code) is a one-shot best-effort send with no retry. A transient SMTP outage means the recipient never gets their confirmation code and has to ask the issuer to re-initiate the transfer. Route transactional emails (especially ones carrying one-time codes) through the existing `email-queue.processor.ts` Bull queue so they get the same retry semantics as other email delivery.

---

**Title:** No pagination/throttling on `ContractEventIndexerService` webhook fan-out during a backlog catch-up
**Labels:** `enhancement` `backend`
**Body:** When the indexer is first enabled against an existing contract with a long event history (or recovers from extended downtime), `syncOnce` can process up to `MAX_PAGES_PER_RUN * PAGE_LIMIT` = 2,000 events every 10 seconds, each potentially firing a webhook via `WebhooksService.triggerEvent`. A newly-enabled indexer against a busy contract could produce a burst of thousands of webhook deliveries in minutes, overwhelming subscriber endpoints with no throttling on the fan-out side. Rate-limit or batch webhook dispatch during backlog catch-up separately from steady-state polling.

---

**Title:** No synchronous way for an issuer to validate a new webhook URL at setup time
**Labels:** `enhancement` `backend`
**Body:** Today `POST /webhooks/test` fires an async job and returns immediately with `{ message: 'Test event queued successfully' }` — the caller has no synchronous feedback on whether their endpoint actually responded correctly (status code, signature verification on their end). Add a synchronous variant (or poll the resulting `WebhookLog` row and return its outcome) so issuers can validate a new webhook URL at setup time instead of discovering failures only after real events start firing.

---

**Title:** `listIssuers` and admin user listing are the only remaining unbounded `findAll()`-style queries left to pave
**Labels:** `enhancement` `backend`
**Body:** Several list endpoints across the admin surface still load full tables before any per-row filtering happens in JS rather than SQL. As the dataset grows, these become full-table scans returned as multi-MB JSON payloads. Standardize all list endpoints on the same `page`/`limit` + DB-level filter pattern already used by the certificate list endpoint.

---

**Title:** `GlobalExceptionFilter` has no per-route allowlist for which internal error details are safe to leak in non-production
**Labels:** `tech-debt` `backend`
**Body:** Error responses vary their verbosity by `NODE_ENV` globally, but there's no per-route control, so a route that's intentionally verbose for one integration partner in staging can't be tightened independently of the rest of the API. Low priority, but worth a documented policy as the API surface grows.

---

## Frontend

---

**Title:** `AccountSecurity` always reports two-factor authentication as "Disabled" regardless of actual status
**Labels:** `bug` `frontend`
**Body:** `App.tsx` renders `<Route path="/security" element={<AccountSecurity />} />` with no props, but `AccountSecurity.tsx` takes `twoFactorEnabled = false` as a prop with no internal fetch of the real value. Every user — including ones who have 2FA enabled — sees "Status: Disabled" on their own security page. The component needs to fetch the user's actual 2FA state instead of relying on a caller-supplied prop nobody passes.

---

**Title:** No frontend support for a 2FA challenge during login
**Labels:** `bug` `enhancement` `frontend`
**Body:** `Login.tsx`'s `handleSubmit` only checks `if (res.accessToken)` after calling `authApi.login`; there is no `AuthResponse` field or UI branch for a "2FA code required" response. If the backend ever returns such a challenge instead of a token, the login form silently resets to idle with no error and no code-entry step. A TOTP/code-entry step needs to be added to the login flow, and `AccountSecurity` needs an actual enable/disable-2FA UI, since none exists anywhere in the frontend.

---

**Title:** Unauthenticated visitors to `/` and `/dashboard` render the full `IssuerDashboard` with failing authenticated API calls
**Labels:** `bug` `frontend`
**Body:** In `App.tsx`, `/` and `/dashboard` route to `<Dashboard />` with no `ProtectedRoute` wrapper. `Dashboard.tsx`'s role switch falls through to `<IssuerDashboard />` whenever `user` is `null` (the default/last branch, not a dedicated logged-out view). Anonymous visitors hitting the root URL get a broken issuer dashboard shell whose data queries 401, rather than a login prompt or a public landing page.

---

**Title:** "Select all" checkbox state goes stale across pagination in `CertificateTable`
**Labels:** `bug` `frontend`
**Body:** `CertificateTable.tsx`'s `selectAll` boolean is only updated when the user clicks a checkbox; it is never recomputed when `page` changes and a new `certificates` array loads. After checking "select all" on page 1 and navigating to page 2, the header checkbox still shows checked even though none of the new page's rows are selected, and vice versa. Derive `selectAll` from `certificates.every(c => selectedIds.has(c.id))` instead of tracking it as independent state.

---

**Title:** `handleSelect`'s "select all" check breaks for partial cross-page selections
**Labels:** `bug` `frontend`
**Body:** `CertificateTable.tsx`'s `setSelectAll(newSelected.size === certificates.length)` compares the full cross-page `selectedIds` size against only the current page's row count. If a user has items selected from a previous page still held in `selectedIds` and then selects every row on the current page, the equality check never matches, and the "select all" checkbox never shows checked even when every visible row is selected.

---

**Title:** Freeze-certificate modal promises "leave empty for indefinite" but the field cannot be emptied
**Labels:** `bug` `frontend`
**Body:** In `CertificateTable.tsx`'s freeze dialog, the helper text reads "Maximum 90 days. Leave empty for indefinite," but `freezeDuration` is a controlled `type="number"` input whose `onChange` always calls `Number(e.target.value)` (yielding `0` for an empty string), and `confirmFreeze` then clamps it with `Math.max(1, ...)`. There is no way to actually submit an indefinite freeze. Either remove the claim or support a genuine "no duration" state that omits `durationDays` from the mutation payload.

---

**Title:** `UserManagement` role editor omits three of the six application roles
**Labels:** `bug` `frontend`
**Body:** `components/admin/users/UserManagement.tsx`'s role `<select>` and `roleBadge` helper only list `admin`, `issuer`, and `recipient`. `VERIFIER`, `AUDITOR`, and `USER` (all present in the `UserRole` enum used elsewhere) have no option in the dropdown, so an admin cannot assign those roles, and a user who already holds one renders with an unmatched/blank select value and an unstyled badge. Generate the options and badge colors from the `UserRole` enum instead of a hardcoded 3-item list.

---

**Title:** `UserActivityModal` is built but never rendered anywhere
**Labels:** `tech-debt` `frontend`
**Body:** `components/admin/users/UserActivityModal.tsx` has no importers in the codebase. The per-user activity detail view is unreachable dead code; either wire it into `UserManagement.tsx` (e.g. a "View Activity" row action) or delete it.

---

**Title:** `UserManagement`'s user list has no pagination — unbounded admin table
**Labels:** `enhancement` `frontend`
**Body:** `useUserListQuery` in `UserManagement.tsx` is called with only `search`/`role` filters and no `page`/`limit`, and the table renders every row returned with no "load more" or page controls. On an instance with thousands of users this renders an enormous DOM table and a single unbounded network response. Add the same page/limit pattern `CertificateTable` already uses.

---

**Title:** `ResetPassword`'s "Request a new reset link" link forces a full page reload
**Labels:** `bug` `frontend`
**Body:** `pages/ResetPassword.tsx` uses a raw `<a href="/login">` instead of a React Router `Link`/`navigate`, discarding the whole SPA state (React Query cache, loaded JS chunks) on every click.

---

**Title:** `AccountSecurity`'s "sign out everywhere" forces a hard `window.location.href` redirect
**Labels:** `tech-debt` `frontend`
**Body:** `pages/AccountSecurity.tsx` navigates with `window.location.href = '/login'` after `revokeAllSessions()` instead of the router's `navigate()`. It happens to work because the access token lives only in memory and a reload clears it anyway, but it bypasses the app's normal auth-state teardown (`clearAuth()`/`queryClient.clear()`) and is inconsistent with how every other authenticated redirect in the app is done.

---

**Title:** Bell icon toggle button in `NotificationDropdown` has no accessible name
**Labels:** `bug` `frontend`
**Body:** The `<button onClick={() => setIsOpen(!isOpen)}>` wrapping the `Bell` icon in `NotificationDropdown.tsx` has no `aria-label`, `aria-expanded`, or `aria-haspopup`. A screen reader announces only "button" with no indication of its purpose or open/closed state, and the unread-count badge text is not programmatically associated with it either.

---

**Title:** Notification items in `NotificationDropdown` are not clickable/navigable
**Labels:** `enhancement` `frontend`
**Body:** Each row in `NotificationDropdown.tsx` only exposes a "mark as read" checkmark button; clicking the notification body itself does nothing. There is no link-through to the certificate, transfer, or user the notification is about, so users must navigate there manually. Add a link/navigate action to the relevant resource when one exists on the notification payload.

---

**Title:** Toast dismissal set (`dismissedIdsRef`) grows without bound for the lifetime of the session
**Labels:** `tech-debt` `frontend`
**Body:** `components/Toast.tsx`'s `dismissedIdsRef` (a `Set<string>`) only ever has IDs added, never pruned, for as long as the `NotificationProvider` tree stays mounted — effectively the whole session for a logged-in SPA user. On a long-lived session with many notifications this is a slow, unbounded memory leak. Prune entries whose source notification has aged out of the "recent" window, or cap the set size.

---

**Title:** `setTokenRefreshCallback` export is dead and would silently unsubscribe `AuthContext` if ever called
**Labels:** `tech-debt` `frontend`
**Body:** `api/tokens.ts` exports both `subscribeTokenRefresh` (additive) and `setTokenRefreshCallback` (calls `_tokenRefreshSubscribers.clear()` before adding). Nothing currently calls `setTokenRefreshCallback`, but if any future code does, it will silently drop `AuthContext`'s and `NotificationContext`'s subscriptions with no error, breaking token-refresh propagation app-wide. Remove the dead export or make it additive like its sibling.

---

**Title:** `apiClient` forces `Content-Type: application/json` on every request, including bodyless `GET`s
**Labels:** `tech-debt` `frontend`
**Body:** `api/endpoints.ts` unconditionally sets `Content-Type: application/json` in `apiClient`, even for `GET`/`DELETE` calls with no body. This is harmless against most servers but is spec-incorrect and can trigger unnecessary CORS preflights on cross-origin requests that would otherwise qualify as "simple requests." Only set the header when `options.body` is present.

---

**Title:** `ProtectedRoute`'s `/verify` special case is unreachable dead code
**Labels:** `tech-debt` `frontend`
**Body:** `guard/ProtectedRoute.tsx` checks `if (location.pathname === "/verify")`, but `App.tsx` already declares `/verify` as a standalone, unguarded route outside any `<ProtectedRoute>` wrapper, so this branch can never execute. It's misleading: a reader assumes `/verify` is routed through the guard when it isn't. Remove the dead branch or move the exemption into the route table where it's actually enforced.

---

**Title:** `IssuanceChart`'s date formatter assumes a fixed `YYYY-MM-DD` shape with no runtime validation
**Labels:** `tech-debt` `frontend`
**Body:** `Dashboard.tsx`'s `formatPeriodLabel` slices `date.slice(5)` assuming a 10-character ISO date; any other granularity (e.g. a monthly `YYYY-MM` period) produces an empty or garbled label with no runtime validation. Narrow the `IssuanceTrendPoint.period` type to the exact format the backend sends, or make the formatter format-agnostic.

---

**Title:** No offline/connectivity banner despite retry logic assuming transient network failures
**Labels:** `enhancement` `frontend`
**Body:** `lib/queryClient.ts` explicitly retries "transport-level failures (offline, DNS, CORS preflight, aborted)," but there is no UI anywhere that tells the user they are offline — failed queries just show inline "Failed to fetch" messages. Add a global offline indicator (using `navigator.onLine` + the `online`/`offline` events) so repeated silent retries don't look like a broken app.

---

**Title:** No client-side content-type/size validation before triggering a bulk export download
**Labels:** `tech-debt` `frontend`
**Body:** `CertificateTable.tsx`'s `handleBulkExport`/`handleBulkExportAll` take whatever `Blob` the server returns and immediately force a download via a synthetic `<a>` click, without checking the response `Content-Type` or handling a JSON error body the server might return with a 200 status. A corrupted or empty export would silently download a garbage file with no feedback.

---

**Title:** `AccountSecurity`'s session list has no indicator for "this device"
**Labels:** `enhancement` `frontend`
**Body:** `AccountSecurity.tsx` lists all active sessions from `listSessions()` but nothing in the rendered rows flags which session is the current one, risking a user revoking their own active session by accident when meaning to revoke a different device. Add a "this device" badge by comparing a session identifier/fingerprint against the current one.

---

**Title:** No password-strength meter or live validation feedback on registration/reset forms
**Labels:** `enhancement` `frontend`
**Body:** `Login.tsx` and `ResetPassword.tsx` both only validate password length (`>= 8`) synchronously on submit, with no live feedback as the user types and no guidance on composition even though such rules likely exist server-side. Users discover a rejected password only after a full round trip. Add inline, live strength/requirement feedback.

---

**Title:** `Dashboard.tsx` bundles all three role dashboards into one 1,350+ line file and chunk
**Labels:** `tech-debt` `frontend`
**Body:** `Dashboard.tsx` contains `IssuerDashboard`, `RecipientDashboard`, `VerifierDashboard`, the chart component, and the role dispatcher, all lazy-loaded as one chunk regardless of which role actually needs it. An admin visiting `/dashboard` downloads and parses the recipient- and verifier-only code paths too. Split each role's dashboard into its own lazy-loaded module and dispatch via route-level code splitting instead of a runtime `if` inside one mega-component.

---

**Title:** Search box in `CertificateTable` reuses the full-page loading spinner on every keystroke-triggered refetch
**Labels:** `enhancement` `frontend`
**Body:** When `debouncedSearch` changes, `certificatesQuery.isPending` drives the same full-table spinner used for the very first load, replacing the entire table (including the filter bar context) rather than just dimming/overlaying the existing rows. This causes a jarring full-table flash on every keystroke-triggered refetch instead of a lightweight inline indicator.

---

**Title:** No bulk "unfreeze" or bulk "transfer" actions, only bulk revoke/export
**Labels:** `enhancement` `frontend`
**Body:** `CertificateTable.tsx` wires bulk mutations only for export and revoke; freeze, unfreeze, and transfer are all single-row-only actions even though the selection UI (`selectedIds`) already exists and could trivially extend to these operations, which are common administrative tasks when handling a batch of disputed certificates.

---

**Title:** No "copy certificate ID" affordance in the certificate detail modal
**Labels:** `enhancement` `frontend`
**Body:** `CertificateTable.tsx`'s certificate-details modal renders `serialNumber`, `txHash`, and `cid` as plain, non-interactive monospace text. Users regularly need these long identifiers for external lookups (block explorers, support tickets) but must manually select and copy the text rather than clicking a copy-to-clipboard button.

---

**Title:** No skip-to-content link or landmark regions for keyboard/screen-reader users
**Labels:** `enhancement` `frontend`
**Body:** `App.tsx`'s top-level layout renders `<Navbar />` followed directly by a `<div className="container ...">` with no `<main>` landmark or "Skip to main content" link. Keyboard and screen-reader users must tab through the full header/notification/theme controls on every single page before reaching page content.

---

**Title:** No test coverage for the certificate freeze/unfreeze/transfer/revoke action flows
**Labels:** `enhancement` `frontend`
**Body:** Despite `CertificateTable.tsx` containing four distinct state-changing dialogs (freeze, revoke, transfer, bulk export) with meaningful edge cases (disabled-button states by certificate status, pending-action locks), there is no accompanying component test suite covering them. Add tests covering each modal's happy path and its disabled/error states.

---

**Title:** No UI exists for the recipient side of a certificate transfer (approve/reject incoming)
**Labels:** `enhancement` `frontend`
**Body:** The transfer flow only supports *initiating* a transfer from `CertificateTable.tsx`; there is no surfaced UI anywhere for the recipient side (approving/rejecting an incoming transfer) despite `ApproveTransferDto`/`RejectTransferDto` types already existing in `api/types.ts`. Add an "incoming transfers" view/action so the approval half of the flow the backend supports is actually reachable from the UI.

---

**Title:** `handleBulkExportAll` has no confirmation step before downloading a potentially huge CSV
**Labels:** `enhancement` `frontend`
**Body:** `CertificateTable.tsx`'s "Export All (N)" button fires `certificateApi.bulkExportAll` immediately on click with no confirmation dialog, unlike the destructive revoke action which requires a reason and an explicit confirm step. For a large filtered result set this can trigger a slow, unexpected multi-megabyte download with a single accidental click.

---

**Title:** A single shared `pendingAction` string disables every row's buttons during any one row's mutation
**Labels:** `tech-debt` `frontend`
**Body:** `CertificateTable.tsx` uses one `pendingAction` state string to disable every action button in the whole table during any in-flight mutation. While one row's freeze request is in flight, every other row's buttons are also disabled with no visual explanation of why, rather than just the row actually being mutated.

---

## Smart Contracts (Soroban)

---

**Title:** `deploy-contracts.sh` prints the admin's raw secret key to stdout at the end of every deployment
**Labels:** `bug` `security` `contracts`
**Body:** The final block of `deploy-contracts.sh` runs `echo "SOROBAN_ADMIN_SECRET=$ADMIN_SECRET"`. Anyone with access to the CI job log, terminal scrollback, or a piped output file captures the live admin secret for the deployed network. Stop echoing the secret entirely (the caller already has it, since they passed it in), or write it only to a file with `chmod 600` and a loud warning never to log it.

---

**Title:** The `AdminMultisigContract` governance layer is never deployed or wired up — `initialize` always sets a single EOA as admin
**Labels:** `bug` `security` `contracts`
**Body:** `deploy-contracts.sh` builds and deploys only `certificate`, `multisig`, and `crl`, never `admin-multisig`, and `initialize` on the certificate contract is called with `--admin "$ADMIN_ADDRESS"` — a plain key-pair address, not the `AdminMultisigContract`'s address. The entire governance module (`admin_multisig.rs`: threshold approvals for upgrades and issuer removal) is fully implemented and tested but structurally unreachable in the only deployment path the repo ships, so every real deployment is governed by one single key whose compromise means total contract takeover. Deploy and initialize `AdminMultisigContract` first, then pass its contract address as `--admin` to the certificate contract's `initialize`.

---

**Title:** `init_multisig_config`/`update_multisig_config` never validate `signers.len() <= max_signers`
**Labels:** `bug` `contracts`
**Body:** Both implementations (duplicated in `lib.rs` and `multisig.rs`) validate `threshold > signers.len()` and `max_signers < threshold`, but never check `signers.len() > max_signers`. An issuer can register 50 signers against `max_signers = 5`; the field is purely decorative and provides no actual cap on signer-set growth. Add `signers.len() as u32 > max_signers` to both validation blocks, and extract the shared validation into one function since the bug is duplicated across both files.

---

**Title:** CRL `revoke_certificate` lets the configured issuer/admin revoke a certificate belonging to a different issuer
**Labels:** `bug` `security` `contracts`
**Body:** `revoke_certificate` in `crl.rs` authorizes the caller against this CRL's own `issuer`/`admin`, then only checks `certificate_exists` on the linked certificate contract — it never confirms the certificate's `issuer` field actually equals this CRL's `issuer`. Since each CRL is deployed per-issuer but the certificate contract is shared, an issuer can revoke any certificate ID that exists anywhere in the shared certificate contract, not just ones they issued. Cross-call `get_certificate` and assert `cert.issuer == Self::get_issuer(&env)` before recording the revocation.

---

**Title:** Five certificate event payload types in `types.rs` are dead code with domain-mismatched field types
**Labels:** `bug` `tech-debt` `contracts`
**Body:** `TransferInitiatedEvent`, `CertificateMetadataUpdatedEvent`, `CertificateExpirySetEvent`, `IssuerAddedEvent`, `IssuerRemovedEvent`, and a wrapping `CertificateEvent` enum are plain `#[contracttype]`, not `#[contractevent]` — they can never actually be published as events — and none are referenced anywhere in `lib.rs`, `multisig.rs`, `admin_multisig.rs`, or `crl.rs`. `TransferInitiatedEvent.transfer_id` and `.certificate_id` are also typed `u64`, but every real ID in the contract is a `String`. Delete the dead types, or properly redefine and wire them with `#[contractevent]` and `String` IDs for the functions below that currently emit nothing.

---

**Title:** `add_issuer` and `remove_issuer` emit no events
**Labels:** `enhancement` `contracts`
**Body:** `add_issuer` and `remove_issuer` in `lib.rs` mutate the authorized-issuer allow-list with no `publish` call. Off-chain indexers and the backend's issuer-sync logic have no on-chain signal when an issuer is added or revoked. Emit a proper `#[contractevent]` from both functions.

---

**Title:** `update_certificate_metadata` emits no event, and `update_metadata_uri` is a redundant duplicate entry point
**Labels:** `enhancement` `tech-debt` `contracts`
**Body:** `update_certificate_metadata` bumps `cert.version.minor` and stores the certificate but publishes nothing, so the backend never learns metadata changed without polling. Separately, `update_metadata_uri` is a one-line wrapper that just calls `update_certificate_metadata` — two public WASM entry points doing the identical operation under different names doubles the contract's exported surface and audit burden for no functional benefit. Add a metadata-updated event publish, and remove the redundant wrapper.

---

**Title:** `set_certificate_expiry` accepts a past timestamp and doesn't require the certificate to be `Active`
**Labels:** `bug` `contracts`
**Body:** `set_certificate_expiry` correctly checks `admin == stored_admin`, but `expiry_time` is accepted as any `u64` with no lower-bound check against `env.ledger().timestamp()`, and there is no check that `cert.status == Active`. An admin can silently re-date a revoked or frozen certificate's expiry, or set an already-past expiry with no diagnostic. Panic when `expiry_time <= env.ledger().timestamp()`, and decide whether non-`Active` certificates should be settable at all.

---

**Title:** `batch_verify_certificates` treats `Frozen` certificates as valid
**Labels:** `bug` `contracts`
**Body:** The `is_revoked` computation in `batch_verify_certificates` checks `Revoked`, `Suspended`, `Expired`, and time-based expiry, but omits `CertificateStatus::Frozen` — contradicting `is_valid`, which returns `false` for any non-`Active` status including `Frozen`. A batch verification of a frozen certificate reports `revoked: false` and counts it `successful`, misleading any verifier relying on the batch path instead of `is_valid`.

---

**Title:** `reissue_certificate` doesn't index the new certificate and leaves the superseded one `Active`
**Labels:** `bug` `contracts`
**Body:** `reissue_certificate` stores the new certificate and publishes `CertificateReissuedEvent`, but never appends the new ID to `IssuerCertIds`/`OwnerCertIds` — so reissued certificates remain invisible to `get_certificates_by_issuer`/`get_certificates_by_owner`. The original certificate is also left with `status: Active`, so both parent and child validate successfully at once despite "supersede" semantics implied by `parent_certificate_id`. Append the new ID to both indexes, and mark the original certificate revoked/superseded with its own event.

---

**Title:** `get_multisig_config` has no real caller/target separation
**Labels:** `bug` `contracts`
**Body:** `get_multisig_config` takes a single `issuer: Address` parameter used as both the config's key and the implicit caller identity: `caller_is_admin = issuer == admin`, and `issuer.require_auth()` is skipped entirely whenever that one address happens to equal the admin. There is no way for the actual admin to read another issuer's multisig config. Add an explicit `caller: Address` parameter, `caller.require_auth()`, and allow it when `caller == issuer || caller == admin`, mirroring the pattern already used correctly in `get_pending_request`/`get_transfer`.

---

**Title:** `paginate_requests` has no `MAX_PAGE_SIZE` cap, unlike `paginate_certificates`
**Labels:** `bug` `contracts`
**Body:** `paginate_certificates` panics when `pagination.limit > MAX_PAGE_SIZE`, but `paginate_requests` — used by both `get_pending_requests_for_issuer` and `get_pending_requests_for_signer` — has no equivalent check. Apply the same `MAX_PAGE_SIZE` guard used in `paginate_certificates`.

---

**Title:** `bump_ttl_on_get` exists but is still not called from any read path
**Labels:** `bug` `tech-debt` `contracts`
**Body:** `storage/ttl.rs` implements `bump_ttl_on_get`, explicitly commented "not yet wired into read paths" and marked `#[allow(dead_code)]`. `get_certificate`, `is_valid`, `batch_verify_certificates`, and the CRL's `is_revoked`/`get_revocation_info` still only extend TTL on write. A certificate that is issued once and never subsequently mutated has a persistent-entry TTL fixed at issuance; if no read-triggered extension happens before that TTL lapses, the ledger entry archives and becomes unreadable regardless of certificate validity period. Call `bump_ttl_on_get` from the hot read paths listed above.

---

**Title:** `AdminMultisigContract` has no way to enumerate pending proposals
**Labels:** `enhancement` `contracts`
**Body:** Unlike the certificate multisig (paginated `get_pending_requests_for_issuer`/`...for_signer`), `admin_multisig.rs` only exposes `get_proposal(proposal_id, caller)`, which requires already knowing the proposal ID. A governance signer has no on-chain way to discover what proposals are awaiting their approval. Add a signer-indexed, paginated `get_pending_proposals_for_signer` mirroring the certificate-multisig pattern.

---

**Title:** `RemovedIssuer` flag in `AdminMultisigContract` can never be cleared
**Labels:** `bug` `contracts`
**Body:** `execute_action`'s `RemoveIssuer` branch sets `AdminMultisigDataKey::RemovedIssuer(issuer) = true` in the admin-multisig contract's own storage, separate from the certificate contract's issuer allow-list that the cross-call actually mutates. If the certificate contract's admin later reinstates that address via `add_issuer`, `is_issuer_removed` on the admin-multisig contract still incorrectly reports `true` forever — there is no `ReAddIssuer` action or reset path. Either remove the redundant tracking (rely solely on the certificate contract's own `is_issuer`) or add a governed un-remove action that clears it.

---

**Title:** Orphaned, non-compiling source still committed alongside working contract code
**Labels:** `tech-debt` `contracts`
**Body:** `lib.rs`'s module declarations wire in `types, multisig, crl, persistent, admin_multisig` but comment out `mod metadata;` entirely, noting that the module it tests "does not currently compile (32 errors)". Carrying known-broken, unreachable source in the same crate as production contract code risks it being accidentally re-enabled (e.g. during a refactor) and breaking the build. Delete `metadata.rs`/`metadata_test.rs` (and any other orphaned, undeclared test files) or finish and wire them in.

---

**Title:** Per-issuer multisig admin key has no rotation or recovery path
**Labels:** `enhancement` `contracts`
**Body:** The per-issuer multisig admin is stored as a single `Address` under `DataKey::IssuerAdmin(issuer)`, set once at `init_multisig_config` and never changeable — there is no `update_issuer_admin` entry point. If that key is lost or compromised, the issuer's multisig configuration (signers, threshold) can never be updated again. Add an admin-rotation entry point (ideally requiring both the current and new admin's joint authorization), or document that `IssuerAdmin` must itself be a multisig/admin-multisig contract address rather than an EOA.

---

**Title:** `revoke_certificate_mirrored` trusts any call authorized as the certificate contract with no additional binding to a specific revocation
**Labels:** `security` `contracts`
**Body:** `CRLContract::revoke_certificate_mirrored` authenticates only `cert_contract.require_auth()` — it trusts that any call authorized as the configured certificate contract address is a genuine mirrored revocation, with no nonce or cross-check against the certificate's actual on-chain status tying the call to a specific, already-recorded revocation. This is safe only as long as `mirror_revocation_to_crl` is the single caller today; any future code path added to the certificate contract that can be made to call this symbol silently revokes a certificate in the CRL without it being revoked in the source of truth. Have the CRL re-verify via its own `certificate_exists` + status cross-call rather than trusting the caller's parameters wholesale.

---

**Title:** `CertificateVersion.build: Option<String>` is defined but no public function ever sets it
**Labels:** `tech-debt` `contracts`
**Body:** `CertificateVersion` carries a `build` field for pre-release/build metadata, but `issue_certificate`, `reissue_certificate`, and `update_certificate_metadata` all hardcode `build: None`. Either remove the field, or expose it through `reissue_certificate`'s parameters.

---

**Title:** No contract-level circuit breaker / pause mechanism for the certificate contract
**Labels:** `enhancement` `security` `contracts`
**Body:** If a vulnerability is discovered in `CertificateContract`, the only mitigation available today is a full WASM upgrade via `upgrade()`, which — given the admin-multisig wiring gap above — currently means a single admin key must act fast enough to push a fix before an exploit is used further. There is no `pause()`/`unpause()` admin-gated switch that can halt `issue_certificate`, `initiate_transfer`, etc. immediately while a fix is prepared. Add an admin-gated `paused: bool` instance flag checked at the top of state-mutating entry points.

---

**Title:** `batch_verify_certificates`'s advertised `total_cost` has no relationship to actual Soroban resource fees
**Labels:** `enhancement` `contracts`
**Body:** `BASE_VERIFICATION_COST`/`COST_PER_CERTIFICATE` are arbitrary constants with no documented unit and no connection to the contract's actual Soroban resource/fee consumption. Any client or UI surfacing `total_cost` to a user as a real cost estimate would be showing a fabricated number. Document clearly that this is an abstract rate-limiting score unrelated to network fees, or remove it.

---

**Title:** A stale CRL (`next_update` passed) is silently served forever with no automated refresh trigger
**Labels:** `enhancement` `contracts`
**Body:** `needs_update` only reports whether `next_update` has passed; nothing calls `update_crl_metadata` automatically, and no entry point rejects reads of a stale CRL. A consumer that doesn't separately poll `needs_update` and refresh keeps trusting a `CRLInfo.merkle_root`/`this_update` that's weeks past its intended refresh window with no on-chain signal. Have `get_crl_info`/`verify_certificate` return (or event-emit) a staleness flag, or integrate a keeper/backend job against `needs_update`.

---

**Title:** `multisig.rs` and `lib.rs` implement two parallel, independently-maintained copies of the certificate multisig flow
**Labels:** `tech-debt` `contracts`
**Body:** `init_multisig_config`, `update_multisig_config`, `propose_certificate`, `approve_request`, `reject_request`, `issue_approved_certificate`, `cancel_request`, and both pagination helpers exist nearly identically in both `lib.rs` (certificate contract build) and `multisig.rs` (standalone multisig contract build). The `max_signers` validation gap filed above reproduces identically in both because the logic was copy-pasted rather than shared. Extract the shared validation/state-machine logic into a common internal module both contract impls call into, so a fix only has to be written once.

---

**Title:** `init_admin_multisig` requires every proposed signer's live authorization with no upper bound on signer-set size
**Labels:** `tech-debt` `contracts`
**Body:** `init_admin_multisig` calls `signer.require_auth()` in a loop over the entire `signers` vector with no cap, meaning a single initialization transaction must gather authorization from an unbounded number of accounts and could exceed the transaction's resource budget for a large governance committee. `validate_config` checks `threshold`/`signers.is_empty()` but places no ceiling on `signers.len()`. Add a reasonable hard cap (e.g. 20-25) on admin-multisig signer count, documented against the known Soroban per-transaction auth-entry limit.

---

## Infrastructure / DevOps / CI

---

**Title:** `frontend-prod`'s production build never receives a `VITE_API_URL` build arg
**Labels:** `bug` `devops`
**Body:** `backend/Dockerfile`'s sibling `frontend/Dockerfile` accepts `ARG VITE_API_URL` for the production build stage, but `docker-compose.yml`'s `frontend-prod` service (the `production` target, used by the `--profile production` deployment) has no `build.args` block at all, so `VITE_API_URL` is always empty for that image — unlike the `frontend` (development) service, which gets it as a runtime env var. Vite bakes `import.meta.env.VITE_API_URL` at build time, so the production SPA bundle ships with a blank or stale API base URL regardless of what's set elsewhere. Pass `VITE_API_URL` as a build arg to the `frontend-prod` service.

---

**Title:** `frontend-prod`'s own `nginx.conf` has no `/api` proxy, making the container unusable standalone
**Labels:** `bug` `devops`
**Body:** `frontend/nginx.conf` (used by the `frontend-prod` image on port 8080) only serves static files and an SPA fallback — it has no `location /api/` proxy block. Only the separate root-level `nginx/nginx.conf` (the `nginx` service, behind the `production` profile) proxies `/api/` to the backend. Anyone running `docker compose --profile production up frontend-prod` without also bringing up the root `nginx` service gets a SPA that can never reach the API, with nothing in the repo explaining that `frontend-prod` must always sit behind the reverse proxy.

---

**Title:** Soroban/contract environment variables are never wired into `docker-compose.yml` or consolidated into `.env.example`
**Labels:** `bug` `devops`
**Body:** `ENABLE_SOROBAN_INTEGRATION`, `SOROBAN_RPC_URL`, `SOROBAN_ADMIN_SECRET`, `CERTIFICATE_CONTRACT_ID`, `MULTISIG_CONTRACT_ID`, and `CRL_CONTRACT_ID` are documented only in the separate `.env.soroban.example` file; `docker-compose.yml` and `.env.example` reference none of them. Running `docker compose up` with the default `.env` boots the full stack successfully but with on-chain contract integration silently disabled/misconfigured — there is no startup warning explaining that certificates will never sync with the deployed contracts. Consolidate all required variables into one template and pass them through `docker-compose.yml` to the backend service.

---

**Title:** Backend/frontend Dockerfiles pin `node:26-alpine`, but CI's backend matrix only tests Node 20 and 22
**Labels:** `bug` `devops`
**Body:** `ci.yml`'s `backend` job runs `strategy.matrix.node-version: [20, 22]`, but both `backend/Dockerfile` and `frontend/Dockerfile` build on `node:26-alpine`. The exact Node major version that actually ships to production is never exercised by the lint/typecheck/test/build steps in CI — a Node-26-specific regression (API removal, engine behavior change) would only surface after the image is already built and deployed. Add 26 (or whichever version the Dockerfiles pin) to the CI test matrix, or pin the Dockerfiles to a version CI already covers.

---

**Title:** Postgres/Redis versions drift across `docker-compose.yml`, `docker-compose.dev.yml`, and `ci.yml`
**Labels:** `tech-debt` `devops`
**Body:** `docker-compose.yml` pins `postgres:15.19-alpine`/`redis:7.4.11-alpine`; `docker-compose.dev.yml` (the fast local dev loop) uses floating `postgres:15-alpine`/`redis:7-alpine`; `ci.yml`'s `backend-e2e` job uses `postgres:15-alpine`/`redis:7-alpine` as GitHub Actions services. Three different effective versions of the same two dependencies are in play depending on which path a developer or CI job takes, and none of them is guaranteed to match what's actually deployed. Pin all three to the same patch version, ideally read from one place (e.g. a shared `.env` or a Compose `x-` anchor).

---

**Title:** No `SECURITY.md` / responsible disclosure policy
**Labels:** `enhancement` `devops`
**Body:** The repo has `CODEOWNERS`, issue/PR templates, and Dependabot configured, but no `SECURITY.md` describing how to report a vulnerability privately. For a project that issues on-chain certificates, holds Stellar secret keys, and signs JWTs and webhook payloads, a missing disclosure policy means a well-intentioned researcher's only option is to file a public GitHub issue, exposing the vulnerability before it can be fixed. Add a `SECURITY.md` with a private contact channel and expected response time.

---

**Title:** `.env.example`'s placeholder Stellar keys are not valid StrKey-checksummed values
**Labels:** `bug` `devops`
**Body:** `STELLAR_ISSUER_SECRET_KEY=SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` and the paired public key in `.env.example` are the right length and prefix but are not valid base32 StrKey values with a correct CRC16 checksum, so any code path that actually decodes them (rather than just reading the string) will throw at startup or on first use. A developer who copies the example verbatim gets an app that *boots* but silently can't sign anything Stellar-related. Either generate a real throwaway testnet keypair for the example, or make this limitation explicit in a comment right next to the values.

---

**Title:** No CD/release workflow exists — a merge to `main` produces no deployable artifact
**Labels:** `enhancement` `devops`
**Body:** `ci.yml` lints, typechecks, tests, and builds Docker images, but nothing pushes an image to a registry, tags a release, or deploys anywhere. The only documented path from source to a running instance is a developer manually running `docker compose up --build` on their own machine. Add a release workflow (image push on tag, or a deploy job gated on `main`) so "merged" and "shippable" aren't permanently the same manual step.

---

**Title:** CI's `backend-e2e` job uses `TYPEORM_SYNCHRONIZE=true` instead of running the real migration files
**Labels:** `bug` `devops`
**Body:** `ci.yml`'s `backend-e2e` job sets `TYPEORM_SYNCHRONIZE: 'true'` so TypeORM derives the schema directly from entities, explicitly to avoid "replaying migrations that are only built for the production image." This means the actual migration files in `src/database/migrations` — the ones `docker-entrypoint.sh` runs in every real deployment — are never executed by CI at all. A migration with a syntax error, a down-incompatible column rename, or a missing index can merge to `main` and only be discovered the first time someone runs `docker compose up` for real. Add a dedicated CI step that builds the backend and runs `typeorm migration:run` against a throwaway Postgres instance.

---

**Title:** No CI job actually runs the Docker images it builds
**Labels:** `enhancement` `devops`
**Body:** `ci.yml`'s `docker` job builds the backend and both frontend targets and validates `nginx.conf` with `nginx -t`, but never starts any of them. A broken `docker-entrypoint.sh` (wrong path, a migration step that silently exits non-zero in a way the script doesn't catch), a missing runtime file, or a container that crash-loops on boot would all pass this job. Extend the job to `docker compose up -d`, poll the backend's `/api/v1/health` endpoint, and fail the job if it never reports healthy.

---

**Title:** No SAST/CodeQL or secret-scanning workflow — `security-audit` is `npm audit` only
**Labels:** `security` `devops`
**Body:** `ci.yml`'s `security-audit` job runs `npm run security:audit` (`npm audit --audit-level=high` across root/backend/frontend), which only catches known-vulnerable dependency versions — it finds nothing about the application's own code. For a codebase handling JWTs, Stellar secret keys, webhook HMAC secrets, and user PII, there is no CodeQL (or equivalent SAST) workflow and no secret-scanning/push-protection configuration checked into the repo. Add a CodeQL workflow for both the TypeScript and Rust code, and enable/document GitHub secret scanning.

---

**Title:** `monitoring/` ships a Prometheus scrape config with no alerting rules and no dashboards
**Labels:** `enhancement` `devops`
**Body:** `monitoring/prometheus.yml` only defines a scrape job against the backend's `/api/v1/metrics` endpoint. There are no Prometheus alerting rules (`rule_files`) and no Grafana (or equivalent) dashboard definitions anywhere in the repo, so the `--profile monitoring` stack collects metrics with nobody ever automatically notified when something goes wrong, and no pre-built view to look at them in. Add a baseline set of alert rules (error rate, queue backlog, job failures) and a starter Grafana dashboard JSON.

---

**Title:** `DOCKER_STARTUP_GUIDE.md` documents the wrong metrics URL
**Labels:** `tech-debt` `devops`
**Body:** `DOCKER_STARTUP_GUIDE.md` lists the metrics endpoint as `http://localhost:3000/metrics`, but `main.ts` sets a global `api` prefix plus URI versioning (`defaultVersion: '1'`) with no opt-out on `MetricsController`, so the real route is `http://localhost:3000/api/v1/metrics` — exactly what `monitoring/prometheus.yml` correctly scrapes. Following the guide's own documented URL returns a 404. Fix the doc to match the actual route.

---

**Title:** No integration test exercises the real cross-stack flow (issue → verify → transfer) end to end
**Labels:** `enhancement` `devops`
**Body:** Frontend (Vitest), backend (Jest unit + e2e), and contracts (`cargo test`) are each tested in isolation, and CI runs them as separate jobs. Nothing in the repo spins up the full stack (frontend, backend, Postgres, Redis, and either real or mocked Soroban RPC) and drives the actual user journey — issue a certificate, verify it, initiate and approve a transfer — through the browser or an API client the way a real user or integration partner would. Add a smoke-level Playwright (or equivalent) suite that runs against `docker compose up` in CI.

---

**Title:** No load/performance testing or defined SLOs anywhere in the repo
**Labels:** `enhancement` `devops`
**Body:** The public certificate-verification endpoint (and the QR/share links that point at it) is an obvious target for a traffic spike — a certificate being shared widely on social media, or a bulk-verification integration partner. There is no load-testing setup (k6, Artillery, Locust, etc.) and no documented latency/error-rate SLOs anywhere in the repo or CI, so a capacity regression would only be discovered in production. Add a basic load-test script for the verification and health endpoints and record a baseline.

---

**Title:** `security-audit` CI job has no `continue-on-error` or triage path for unfixable transitive advisories
**Labels:** `tech-debt` `devops`
**Body:** `npm run security:audit` runs `npm audit --audit-level=high` with a hard failure on any match across root, backend, and frontend. When a high-severity advisory exists only in a transitive dependency with no available fix (a common, recurring situation), the entire CI pipeline blocks on every PR until upstream publishes a patch, with no documented allowlist/waiver mechanism in the repo for acknowledged, accepted-risk advisories. Add an `audit-ci`/`npm audit` allowlist file (or equivalent) so a reviewed, temporarily-unfixable advisory doesn't block unrelated work.
