#!/usr/bin/env node
/**
 * Load test for the public certificate-verification and health endpoints.
 *
 * Zero-dependency Node script (requires Node >= 18 for global fetch).
 * Simulates a traffic spike against the endpoints a viral QR/share link or a
 * bulk-verification integration partner would hit:
 *
 *   GET /api/v1/certificates/verify/:code   (public verification)
 *   GET /api/v1/certificates/verify/stellar/:hash
 *   GET /api/v1/health/live                 (liveness probe, no dependency checks)
 *   GET /api/v1/health                      (full health check: DB + Stellar + Redis)
 *
 * Usage:
 *   node load-test/load-test.mjs [options]
 *
 * Options (flags override env vars):
 *   --url <base>        Base URL of the backend          (BASE_URL, default http://localhost:3000)
 *   --concurrency <n>   Parallel workers                 (CONCURRENCY, default 20)
 *   --duration <sec>    Test duration in seconds         (DURATION, default 30)
 *   --verify-weight <%> Share of traffic for /verify/:code (VERIFY_WEIGHT, default 80)
 *   --code <code>       Real verification code to hit    (VERIFY_CODE; default: random codes)
 *   --stellar-hash <h>  Real stellar tx hash to hit      (STELLAR_HASH; default: random hashes)
 *   --save-baseline     Also write results to load-test/baseline.json
 *   --out <file>        Write JSON results to <file>     (default load-test/results/<timestamp>.json)
 *   --help              Show this help
 *
 * Examples:
 *   node load-test/load-test.mjs --duration 60 --concurrency 50
 *   BASE_URL=https://staging.example.com VERIFY_CODE=AB12CD34 \
 *     node load-test/load-test.mjs --duration 120 --save-baseline
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------- argument parsing ----------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--save-baseline') args.saveBaseline = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else {
        args[key] = next;
        i++;
      }
    } else args._.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(
    'Usage: node load-test/load-test.mjs [--url <base>] [--concurrency <n>] ' +
      '[--duration <sec>] [--verify-weight <%>] [--code <code>] [--stellar-hash <h>] [--save-baseline] [--out <file>]',
  );
  process.exit(0);
}

const BASE_URL = (args.url || process.env.BASE_URL || 'http://localhost:3000').replace(
  /\/+$/,
  '',
);
const CONCURRENCY = parseInt(args.concurrency || process.env.CONCURRENCY || '20', 10);
const DURATION_SEC = parseInt(args.duration || process.env.DURATION || '30', 10);
const VERIFY_WEIGHT = parseInt(args['verify-weight'] || process.env.VERIFY_WEIGHT || '80', 10);
const VERIFY_CODE = args.code || process.env.VERIFY_CODE || null;
const STELLAR_HASH = args['stellar-hash'] || process.env.STELLAR_HASH || null;
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '10000', 10);

// ---------- scenario mix ----------
// Weights roughly model a viral-cert spike: most traffic is public code
// verification (QR scans / shared links), some liveness probes, a little of
// the expensive full health check and stellar-hash lookups.
const SCENARIOS = [
  { name: 'verify_code', weight: VERIFY_WEIGHT, path: () => `/api/v1/certificates/verify/${verifyCode()}` },
  { name: 'health_live', weight: Math.round((100 - VERIFY_WEIGHT) * 0.6), path: () => '/api/v1/health/live' },
  { name: 'health_full', weight: Math.round((100 - VERIFY_WEIGHT) * 0.3), path: () => '/api/v1/health' },
  { name: 'verify_stellar', weight: Math.round((100 - VERIFY_WEIGHT) * 0.1), path: () => `/api/v1/certificates/verify/stellar/${STELLAR_HASH || randomHex(64)}` },
];

function randomAlphanumeric(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function randomHex(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
function verifyCode() {
  // A fixed real code exercises the found-path (DB hit + verification record);
  // random codes exercise the not-found path. Both are valid spike shapes.
  return VERIFY_CODE || randomAlphanumeric(8);
}

function pickScenario() {
  const total = SCENARIOS.reduce((s, sc) => s + sc.weight, 0);
  let r = Math.random() * total;
  for (const sc of SCENARIOS) {
    r -= sc.weight;
    if (r <= 0) return sc;
  }
  return SCENARIOS[0];
}

// ---------- metrics ----------
// A response is classified by status:
//   ok           2xx/3xx
//   rateLimited  429 — the app's own rate limiter doing its job; reported
//                separately because a spike that hits it is a capacity signal,
//                not an application error.
//   notFound     404 — expected for unknown codes/hashes (verify_code returns
//                200 with status:'not_found', but verify/stellar 404s).
//   error        5xx, or no response at all (timeout / connection failure).
const results = new Map(); // scenario name -> stats
for (const sc of SCENARIOS)
  results.set(sc.name, {
    latencies: [],
    statuses: {},
    ok: 0,
    rateLimited: 0,
    notFound: 0,
    errors: 0,
    count: 0,
  });

function record(name, ms, status) {
  const bucket = results.get(name);
  bucket.count++;
  bucket.statuses[status] = (bucket.statuses[status] || 0) + 1;
  if (status >= 200 && status < 400) {
    bucket.ok++;
    bucket.latencies.push(ms);
  } else if (status === 429) {
    bucket.rateLimited++;
    bucket.latencies.push(ms);
  } else if (status === 404) {
    bucket.notFound++;
    bucket.latencies.push(ms);
  } else {
    bucket.errors++;
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

// ---------- worker ----------
async function worker(deadline) {
  while (Date.now() < deadline) {
    const sc = pickScenario();
    const url = BASE_URL + sc.path();
    const start = performance.now();
    let status = 0; // 0 = no HTTP response (network error / timeout)
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'user-agent': 'stellarcert-load-test/1.0' },
      });
      status = res.status;
      // Drain body so the connection is released promptly.
      await res.arrayBuffer();
    } catch {
      status = 0;
    }
    record(sc.name, performance.now() - start, status);
  }
}

// ---------- run ----------
console.log(`Load test against ${BASE_URL}`);
console.log(`  concurrency: ${CONCURRENCY} workers, duration: ${DURATION_SEC}s, timeout: ${TIMEOUT_MS}ms`);
console.log(`  verify code: ${VERIFY_CODE ? VERIFY_CODE : '<random 8-char codes>'}`);
console.log('  scenarios:');
for (const sc of SCENARIOS) console.log(`    ${sc.name.padEnd(15)} weight=${sc.weight}`);
console.log('');

const startedAt = new Date();
const deadline = Date.now() + DURATION_SEC * 1000;
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(deadline)));
const endedAt = new Date();

// ---------- report ----------
const allLat = [];
let total = 0;
let totalErrors = 0;
let totalRateLimited = 0;
const perScenario = {};

for (const [name, b] of results) {
  const sorted = b.latencies.slice().sort((a, c) => a - c);
  for (const l of sorted) allLat.push(l);
  total += b.count;
  totalErrors += b.errors;
  totalRateLimited += b.rateLimited;
  perScenario[name] = {
    requests: b.count,
    ok: b.ok,
    rateLimited: b.rateLimited,
    notFound: b.notFound,
    errors: b.errors,
    errorRate: b.count ? +(b.errors / b.count).toFixed(4) : 0,
    rateLimitedRate: b.count ? +(b.rateLimited / b.count).toFixed(4) : 0,
    statuses: b.statuses,
    p50: percentile(sorted, 50) !== null ? +percentile(sorted, 50).toFixed(1) : null,
    p95: percentile(sorted, 95) !== null ? +percentile(sorted, 95).toFixed(1) : null,
    p99: percentile(sorted, 99) !== null ? +percentile(sorted, 99).toFixed(1) : null,
    max: sorted.length ? +sorted[sorted.length - 1].toFixed(1) : null,
  };
}
allLat.sort((a, b) => a - b);
const wallSec = (endedAt - startedAt) / 1000;

const report = {
  startedAt: startedAt.toISOString(),
  endedAt: endedAt.toISOString(),
  durationSec: +wallSec.toFixed(2),
  baseUrl: BASE_URL,
  concurrency: CONCURRENCY,
  verifyCode: VERIFY_CODE,
  totals: {
    requests: total,
    errors: totalErrors,
    rateLimited: totalRateLimited,
    errorRate: total ? +(totalErrors / total).toFixed(4) : 0,
    rateLimitedRate: total ? +(totalRateLimited / total).toFixed(4) : 0,
    throughputRps: total ? +(total / wallSec).toFixed(1) : 0,
    p50: percentile(allLat, 50) !== null ? +percentile(allLat, 50).toFixed(1) : null,
    p95: percentile(allLat, 95) !== null ? +percentile(allLat, 95).toFixed(1) : null,
    p99: percentile(allLat, 99) !== null ? +percentile(allLat, 99).toFixed(1) : null,
    max: allLat.length ? +allLat[allLat.length - 1].toFixed(1) : null,
  },
  scenarios: perScenario,
};

console.log('Results');
console.log('--------');
for (const [name, s] of Object.entries(perScenario)) {
  console.log(
    `  ${name.padEnd(15)} reqs=${String(s.requests).padStart(6)} ` +
      `err=${(s.errorRate * 100).toFixed(2)}% rl=${(s.rateLimitedRate * 100).toFixed(2)}% ` +
      `p50=${s.p50 ?? '-'}ms p95=${s.p95 ?? '-'}ms p99=${s.p99 ?? '-'}ms`,
  );
}
console.log('--------');
console.log(
  `  TOTAL           reqs=${total} err=${(report.totals.errorRate * 100).toFixed(2)}% ` +
    `rl=${(report.totals.rateLimitedRate * 100).toFixed(2)}% ` +
    `throughput=${report.totals.throughputRps}rps ` +
    `p50=${report.totals.p50}ms p95=${report.totals.p95}ms p99=${report.totals.p99}ms`,
);

// ---------- persist ----------
const outFile = args.out
  ? resolve(args.out)
  : resolve(__dirname, 'results', `${startedAt.toISOString().replace(/[:.]/g, '-')}.json`);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(`\nWrote ${outFile}`);

if (args.saveBaseline) {
  const baselinePath = resolve(__dirname, 'baseline.json');
  writeFileSync(baselinePath, JSON.stringify(report, null, 2));
  console.log(`Wrote baseline ${baselinePath}`);
}
