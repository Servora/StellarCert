#!/usr/bin/env node
/**
 * API route alignment guard.
 *
 * Why this exists: Frontend API calls in `src/api/endpoints.ts` must match
 * real routes defined in the backend OpenAPI document / NestJS controllers.
 * When frontend paths and backend routes drift apart, requests return 404
 * unnoticed until runtime.
 *
 * This script extracts all `apiClient` / `apiClientRaw` path templates from
 * `src/api/endpoints.ts` and verifies that each path has a corresponding route
 * implemented in the backend controllers.
 *
 * Usage: node scripts/check-api-routes.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(FRONTEND_ROOT, '..');
const ENDPOINTS_FILE = join(FRONTEND_ROOT, 'src/api/endpoints.ts');
const BACKEND_SRC = join(REPO_ROOT, 'backend/src');

function findControllers(dir) {
  let results = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        results = results.concat(findControllers(full));
      } else if (entry.endsWith('.controller.ts')) {
        results.push(full);
      }
    }
  } catch {
    // If backend directory is not present, skip
  }
  return results;
}

// 1. Collect all backend routes from controllers
const controllerFiles = findControllers(BACKEND_SRC);
const backendRoutePatterns = [];

for (const file of controllerFiles) {
  const content = readFileSync(file, 'utf8');

  // Find controller base path
  const controllerMatch = content.match(
    /@Controller\(\s*(?:['"`]([^'"`]*)['"`]|(?:\{\s*path:\s*['"`]([^'"`]*)['"`]))?\s*\)/
  );
  const basePrefix = controllerMatch
    ? (controllerMatch[1] ?? controllerMatch[2] ?? '')
    : '';

  // Find all HTTP method decorators
  const methodRegex =
    /@(Get|Post|Put|Delete|Patch)\(\s*(?:['"`]([^'"`]*)['"`]|(?:\{\s*path:\s*['"`]([^'"`]*)['"`]))?\s*\)/g;
  let match;
  while ((match = methodRegex.exec(content)) !== null) {
    const subPath = match[2] ?? match[3] ?? '';
    // Join without a leading slash, then add exactly one. (Prefixing '/' to a
    // path that already started with one produced '//auth/login', which
    // matched nothing.)
    const joined = [basePrefix, subPath]
      .filter(Boolean)
      .join('/')
      .replace(/\/+/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
    const normalized = '/' + joined;

    // Convert :param and wildcard patterns into regex
    const regexPattern = new RegExp(
      '^' +
        normalized
          .replace(/:[a-zA-Z0-9_]+/g, '[^/]+')
          .replace(/\*/g, '.*') +
        '$'
    );
    backendRoutePatterns.push({ path: normalized, regex: regexPattern });
  }
}

// 2. Extract frontend endpoints from endpoints.ts
const endpointsContent = readFileSync(ENDPOINTS_FILE, 'utf8');
const frontendRoutes = new Set();
const apiCallRegex =
  /apiClient(?:Raw)?(?:<[^>]+>)?\(\s*(?:`([^`]+)`|'([^']+)'|"([^"]+)")/g;

let fMatch;
while ((fMatch = apiCallRegex.exec(endpointsContent)) !== null) {
  let raw = fMatch[1] ?? fMatch[2] ?? fMatch[3];

  // Skip auth endpoints object reference
  if (raw.includes('AUTH_ENDPOINTS')) continue;

  // Strip baseUrl variable or literal host if present
  raw = raw.replace(/^\$\{[A-Za-z0-9_]+\}/, '').replace(/^https?:\/\/[^/]+/, '');

  // Strip query string
  raw = raw.split('?')[0];

  // Normalize template interpolations like ${id} or ${certificateId} to a placeholder
  raw = raw.replace(/\$\{[^}]+\}/g, 'PLACEHOLDER');
  // A nested template literal (`${cond ? `?a=${x}` : ''}`) is cut short by the
  // regex above, leaving an unterminated "${"; whatever follows is a query.
  raw = raw.replace(/\$\{.*$/, '');

  if (raw.startsWith('/')) {
    frontendRoutes.add(raw);
  }
}

// Add well-known auth routes that are accessed via constants
const knownAuthRoutes = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/logout',
];
for (const r of knownAuthRoutes) {
  frontendRoutes.add(r);
}

// 3. Diff frontend routes against backend routes
const unmatchedRoutes = [];

for (const fRoute of frontendRoutes) {
  // Test if fRoute matches any backendRoutePattern
  const testPath = fRoute.replace(/PLACEHOLDER/g, 'dummy');
  const matched = backendRoutePatterns.some((pattern) =>
    pattern.regex.test(testPath)
  );

  if (!matched) {
    unmatchedRoutes.push(fRoute);
  }
}

if (unmatchedRoutes.length > 0) {
  console.error(
    `Error: Found ${unmatchedRoutes.length} frontend route(s) with no matching backend route:`
  );
  for (const r of unmatchedRoutes) {
    console.error(`  - ${r}`);
  }
  process.exit(1);
} else {
  console.log(
    `All ${frontendRoutes.size} frontend API routes match backend controller endpoints.`
  );
}
