#!/usr/bin/env node
/**
 * Fails when an import specifier in `frontend/src` points at a path whose
 * on-disk name differs in case from the specifier — the class of bug that
 * blanks the 404 route on Linux/CI (#744).
 *
 * macOS and Windows resolve `./pages/Notfound` and `./pages/NotFound` to the
 * same file, so a rename that breaks a case-sensitive checkout passes locally
 * and only fails on CI. This check compares every specifier against the real
 * directory entries (`readdir` always reports on-disk case, on every platform),
 * so it fails on the developer's machine too.
 *
 * Only relative (`./`, `../`) and `@/` (Vite alias -> `src`) specifiers are
 * checked; bare package imports are ignored.
 *
 * Usage: npm run check:imports
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(path.resolve(here, '..'), 'src');
const ALIAS = '@/';
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css'];

const SPEC_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Case-exact existence: `readdir` reports real on-disk names everywhere. */
function isExact(abs) {
  const root = path.parse(abs).root;
  let cur = root;
  for (const seg of abs.slice(root.length).split(path.sep)) {
    let entries;
    try {
      entries = readdirSync(cur);
    } catch {
      return false;
    }
    if (!entries.includes(seg)) return false;
    cur = path.join(cur, seg);
  }
  return true;
}

/** The same path with on-disk casing, or null when it does not exist at all. */
function realCasing(abs) {
  const root = path.parse(abs).root;
  let cur = root;
  for (const seg of abs.slice(root.length).split(path.sep)) {
    let entries;
    try {
      entries = readdirSync(cur);
    } catch {
      return null;
    }
    const match = entries.includes(seg)
      ? seg
      : entries.find((e) => e.toLowerCase() === seg.toLowerCase());
    if (!match) return null;
    cur = path.join(cur, match);
  }
  return cur;
}

function candidates(base) {
  const list = [base];
  for (const ext of EXTS) list.push(base + ext);
  for (const ext of EXTS) list.push(path.join(base, 'index' + ext));
  return list;
}

function checkSpecifier(fromFile, spec) {
  const clean = spec.split('?')[0].split('#')[0];
  if (!clean.startsWith('.') && !clean.startsWith(ALIAS)) return null;

  const base = clean.startsWith(ALIAS)
    ? path.join(srcDir, clean.slice(ALIAS.length))
    : path.resolve(path.dirname(fromFile), clean);

  for (const candidate of candidates(base)) {
    try {
      if (isExact(candidate) && statSync(candidate).isFile()) return null;
    } catch {
      /* keep looking */
    }
  }

  // Nothing matched exactly — report the intended file if it exists off-case.
  for (const candidate of candidates(base)) {
    const actual = realCasing(candidate);
    if (actual && actual !== candidate && statSync(actual).isFile()) {
      return actual;
    }
  }

  // Unresolved specifier (asset, virtual module, generated file, ...): ignore.
  return null;
}

const problems = [];
for (const file of walk(srcDir)) {
  const source = readFileSync(file, 'utf8');
  const rel = path.relative(path.resolve(srcDir, '..'), file);
  for (const match of source.matchAll(SPEC_RE)) {
    const spec = match[1];
    const actual = checkSpecifier(file, spec);
    if (!actual) continue;
    const line = source.slice(0, match.index).split('\n').length;
    problems.push({ rel, line, spec, actual: path.relative(path.resolve(srcDir, '..'), actual) });
  }
}

if (problems.length > 0) {
  console.error('✖ Import paths whose on-disk case does not match the specifier:\n');
  for (const p of problems) {
    console.error(`  ${p.rel}:${p.line}`);
    console.error(`    imported as '${p.spec}'`);
    console.error(`    on disk   '${p.actual}'\n`);
  }
  console.error(
    `${problems.length} mismatch(es) found. Case-sensitive checkouts (Linux, CI) will fail to resolve these.`,
  );
  process.exit(1);
}

console.log('✔ All relative and @/ imports in frontend/src match on-disk path case.');
