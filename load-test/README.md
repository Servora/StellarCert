# Load testing

Basic load test for the public endpoints that see spike traffic: certificate
verification (QR/share links) and health probes.

## Endpoints covered

| Scenario | Path | Notes |
| --- | --- | --- |
| `verify_code` | `GET /api/v1/certificates/verify/:code` | Public verification. With `VERIFY_CODE` set it exercises the found path (DB read + verification record + webhook trigger); without it, random 8-char codes exercise the not-found path. Both shapes occur in the wild. |
| `verify_stellar` | `GET /api/v1/certificates/verify/stellar/:hash` | Stellar transaction-hash lookup. |
| `health_live` | `GET /api/v1/health/live` | Liveness probe; no dependency checks. |
| `health_full` | `GET /api/v1/health` | Full check: Postgres + Stellar + Redis. Deliberately kept a small share of traffic — it is expensive and is not what end users hit. |

## Running

Requires Node >= 18 (uses global `fetch`). No dependencies to install.

```bash
# Default: 20 concurrent workers for 30s against http://localhost:3000
node load-test/load-test.mjs

# Harder spike, against a deployed environment, saving a baseline
BASE_URL=https://api.example.com \
VERIFY_CODE=AB12CD34 \
node load-test/load-test.mjs --duration 120 --concurrency 100 --save-baseline

# Via npm script
npm run test:load -- --duration 60 --concurrency 50
```

Every run writes a JSON report to `load-test/results/<timestamp>.json`
(git-ignored). `--save-baseline` additionally writes `load-test/baseline.json`,
which is committed so regressions can be compared against a recorded run.

### Response classification

- `ok` — HTTP 2xx/3xx.
- `rateLimited` — HTTP 429 from the app's own rate limiter. Reported separately
  from errors: a spike that hits the limiter is a capacity/config signal, not
  an application failure. See "Rate limits" below.
- `notFound` — HTTP 404 (expected for unknown stellar hashes; `verify/:code`
  returns 200 with `status: 'not_found'` instead).
- `errors` — HTTP 5xx or no response at all (timeout / connection failure).
  Latency percentiles are computed over all answered requests.

### Rate limits (important for spike testing)

The app has a global per-IP rate limit (`RateLimitGuard`, an `APP_GUARD`):

- `RATE_LIMIT_DEFAULT_WINDOW_MS` (default 60 000) and
  `RATE_LIMIT_DEFAULT_MAX_REQUESTS` — **120 req/min in production, 1000 req/min
  in development**.
- `VERIFICATION_RATE_LIMIT_WINDOW_MS` / `VERIFICATION_RATE_LIMIT_MAX_REQUESTS`
  (default 100 req/min) back the `IpRateLimitGuard`, which is currently only
  wired into the health module's rate-limit controller, not the verify routes.

A single IP — or many users behind one NAT — hits the ceiling long before the
app does. To measure raw endpoint capacity, raise the limits for the test run:

```bash
RATE_LIMIT_DEFAULT_MAX_REQUESTS=1000000 VERIFICATION_RATE_LIMIT_MAX_REQUESTS=1000000 \
  node load-test/load-test.mjs --duration 60 --concurrency 25
```

To measure behavior *with* the production limiter in place, leave the defaults
(or set `NODE_ENV=production`-equivalent values) and read the `rl=` column.

## Proposed SLOs

These are starting targets for the public verification path, measured at the
mix above (80% `verify_code` by default). Adjust once real production traffic
characteristics are known.

| Metric | Target |
| --- | --- |
| `verify_code` p95 latency | < 300 ms |
| `verify_code` p99 latency | < 800 ms |
| `verify_code` error rate (5xx/network) | < 1% |
| `verify_code` rate-limited share | < 5% at expected spike load |
| `health_live` p95 latency | < 100 ms |

A run "passes" when the totals meet the error-rate target and the `verify_code`
scenario meets the latency targets at the configured concurrency.

## Recorded baseline

`load-test/baseline.json` — recorded 2026-11-18 against a local dev stack
(`nest` build, Postgres 15 + Redis 7 in Docker, single instance, Apple Silicon
MacBook, Node 20 client on the same host), 60s at 25 concurrent workers,
~666 rps achieved, rate limits raised via env as above:

| Scenario | Requests | Errors | p50 | p95 | p99 |
| --- | --- | --- | --- | --- | --- |
| `verify_code` (found path) | 32 070 | 0.00% | 15.7 ms | 26.4 ms | 35.6 ms |
| `verify_stellar` (found path) | 779 | 0.00% | 7.5 ms | 13.2 ms | 22.6 ms |
| `health_live` | 4 852 | 0.00% | 4.3 ms | 8.3 ms | 11.8 ms |
| `health_full` | 2 493 | 11.19% (all 503) | 339 ms | 621 ms | 1 502 ms |

Findings worth noting:

- `verify/:code` and `verify/stellar/:hash` are fast and stable well beyond
  ~650 rps from a single client; the DB lookup is indexed and cheap.
- `GET /api/v1/health` (full check: Postgres + Stellar horizon + Redis) is **not
  spike-safe**: ~11% of concurrent calls returned 503 at only ~40 rps of that
  scenario, with p99 ~1.5 s. It is a probe endpoint so real traffic is low, but
  load balancers/k8s should point at `/health/live` or `/health/ready` and keep
  `/health` for low-rate diagnostics — or the health checks need caching/timeouts.
- With default dev rate limits (1000 req/min/IP), a 25-worker run from one IP
  got **~96% HTTP 429** within seconds (`load-test/results/2026-11-18T19-50-55-090Z.json`).
  In production the cap is 120 req/min/IP, so a viral certificate shared as a
  QR/link will 429 legitimate viewers unless the verify routes get a higher
  limit, a CDN/edge cache, or per-IP limits are revisited. This is the biggest
  capacity risk the baseline exposed.

Caveats: numbers are from one dev machine against localhost — treat them as a
relative regression baseline, not a production capacity claim. Re-run against
staging/production-like infra before drawing absolute conclusions.

## Recording a baseline

1. Start the stack (`npm run dev:deps` then `npm run dev:backend`, or the full
   `docker compose up`).
2. Seed at least one certificate so `VERIFY_CODE` can point at a real code.
3. Run:

   ```bash
   BASE_URL=http://localhost:3000 VERIFY_CODE=<real-code> \
     node load-test/load-test.mjs --duration 60 --concurrency 25 --save-baseline
   ```

4. Commit `load-test/baseline.json` together with the code under test. On
   subsequent runs, diff the new `results/*.json` against the baseline to spot
   capacity regressions before they reach production.

## Notes / caveats

- The script is client-side only; it measures end-to-end latency from wherever
  it runs. For meaningful numbers, run it from a machine/network close to the
  target (or inside the same host/VPC).
- `verify_code` with a real code writes a verification record and can trigger
  issuer webhooks per request — keep `--duration`/`--concurrency` modest
  against environments with live webhook endpoints, or use random codes.
- This is intentionally a smoke-level baseline tool, not a substitute for a CI
  load gate. If CI integration is wanted later, wrap this script (or port it to
  k6/Artillery) in a workflow that runs it against a staging deploy.
