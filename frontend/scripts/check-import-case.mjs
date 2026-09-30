#!/usr/bin/env node
/**
 * Import-casing guard.
 *
 * Why this exists: macOS and Windows check out repositories on case-insensitive
 * filesystems, so `import('./pages/NotFound')` still resolves when the file on
 * disk is `Notfound.tsx`. Linux (every CI runner, every container) is
 * case-sensitive, so the very same specifier fails there — at build time for
 * static imports, and at runtime for `React.lazy` chunks, which is how a
 * casing typo turns into a blank 404 page instead of a build error.
 *
 * This script resolves every relative import/export specifier that appears in
 * `src/` against the real directory listing using exact string comparison, and
 * exits non-zero listing the offenders. It has no dependencies on purpose so
 * it can run before (or without) `npm ci`.
 *
 * Scope: relative specifiers only (`./x`, `../x`). Bare package imports and
 * tsconfig `paths` aliases (e.g. `@/x`) are intentionally skipped — they are
 * resolved by the bundler/tsc, not by the filesystem layout this guard checks.
 *
 * Usage: node scripts/check-import-case.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_ROOT = join(FRONTEND_ROOT, "src");

// Extensions Vite/tsc will resolve for an extension-less specifier, plus the
// asset kinds imported directly in this project.
const EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".scss",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".html",
];

// NodeNext-style specifiers use a `.js` extension that is really a `.ts` file
// on disk. Map the written extension to the ones it may stand for.
const EXTENSION_ALIASES = {
  ".js": [".js", ".ts", ".tsx"],
  ".jsx": [".jsx", ".tsx"],
  ".mjs": [".mjs", ".mts"],
  ".cjs": [".cjs", ".cts"],
};

/** All files under `dir`, as paths relative to SRC_ROOT, POSIX-separated. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...walk(abs));
    else out.push(relative(SRC_ROOT, abs).split(sep).join("/"));
  }
  return out;
}

/**
 * The specifier with any Vite query suffix removed (`./x.css?inline`).
 */
function stripQuery(specifier) {
  const queryAt = specifier.search(/[?#]/);
  return queryAt === -1 ? specifier : specifier.slice(0, queryAt);
}

/** Candidate on-disk paths for `base`, most-exact first. */
function candidatesFor(base) {
  const candidates = [base];

  const dot = base.lastIndexOf(".");
  const slash = base.lastIndexOf("/");
  const hasExtension = dot > slash;
  if (hasExtension) {
    const alias = EXTENSION_ALIASES[base.slice(dot)] ?? [];
    for (const ext of alias) candidates.push(base.slice(0, dot) + ext);
    return candidates;
  }

  for (const ext of EXTENSIONS) candidates.push(base + ext);
  for (const ext of EXTENSIONS) candidates.push(posix.join(base, `index${ext}`));
  return candidates;
}

/**
 * Blanks out comments so that prose inside them can never be parsed as an
 * import (a doc comment saying `imports from "../api"` is not code). The
 * `(^|[^:])` guard keeps `https://…` string literals intact.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

// `\b` after `import`/`export` keeps words like "imports"/"exported" out.
const IMPORT_RE =
  /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|\b(?:import|require)\s*\(\s*["']([^"']+)["']/g;

function specifiersIn(source) {
  const found = new Set();
  for (const match of stripComments(source).matchAll(IMPORT_RE)) {
    const specifier = match[1] ?? match[2];
    if (specifier) found.add(specifier);
  }
  return found;
}

const files = walk(SRC_ROOT);
const exactSet = new Set(files);
const lowerToExact = new Map(files.map((p) => [p.toLowerCase(), p]));

const mismatches = [];
const unresolved = [];

for (const relPath of files) {
  if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(relPath)) continue;

  const source = readFileSync(join(SRC_ROOT, relPath), "utf8");

  for (const rawSpecifier of specifiersIn(source)) {
    if (!rawSpecifier.startsWith(".")) continue; // bare/alias import

    const specifier = stripQuery(rawSpecifier);
    const base = posix.normalize(
      posix.join(posix.dirname(relPath), specifier),
    );

    const candidates = candidatesFor(base);
    if (candidates.some((c) => exactSet.has(c))) continue;

    // Does the same path exist under a different casing? Then this is exactly
    // the defect this guard is for.
    const wrongCase = candidates
      .map((c) => lowerToExact.get(c.toLowerCase()))
      .find(Boolean);
    if (wrongCase) mismatches.push({ relPath, specifier, wrongCase });
    else unresolved.push({ relPath, specifier });
  }
}

if (mismatches.length > 0) {
  console.error("Import casing errors (these break on case-sensitive filesystems):");
  for (const { relPath, specifier, wrongCase } of mismatches) {
    console.error(`  src/${relPath}`);
    console.error(`      imports "${specifier}"`);
    console.error(`      on disk: src/${wrongCase}`);
  }
  console.error(
    `\n${mismatches.length} mismatch(es) found. Fix the specifier or rename the file so they match exactly.`,
  );
  process.exit(1);
}

if (unresolved.length > 0) {
  // Reported as a warning only: a specifier may be resolved by a tsconfig
  // alias or a Vite plugin this dependency-free guard cannot see.
  console.warn("Unresolved relative imports (not matched to a file; verify manually):");
  for (const { relPath, specifier } of unresolved) {
    console.warn(`  src/${relPath} -> "${specifier}"`);
  }
}

console.log(
  `Import casing OK: checked ${files.length} files under src/ (${mismatches.length} mismatches).`,
);
