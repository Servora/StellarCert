import * as vm from 'vm';

/** Longest time a single pattern test may run before it is aborted. */
export const PATTERN_TEST_TIMEOUT_MS = 100;
/** Longest value that is tested against a user-defined pattern. */
export const MAX_PATTERN_INPUT_LENGTH = 10_000;
/** Largest upper bound accepted in a counted repetition such as `{1,5000}`. */
const MAX_REPEAT_BOUND = 1000;

export class PatternTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Pattern evaluation exceeded ${timeoutMs}ms`);
    this.name = 'PatternTimeoutError';
  }
}

const CLASS_ESCAPES = new Set(['w', 'W', 'd', 'D', 's', 'S']);

/** Reads a quantifier starting at `index`; returns null when there is none. */
function readQuantifier(
  pattern: string,
  index: number,
): { repeating: boolean; length: number; max: number } | null {
  const ch = pattern[index];
  if (ch === '+' || ch === '*') {
    return { repeating: true, length: 1, max: Infinity };
  }
  if (ch === '?') return { repeating: false, length: 1, max: 1 };
  if (ch === '{') {
    const match = /^\{(\d+)(?:(,)(\d*))?\}/.exec(pattern.slice(index));
    if (!match) return null;
    const max = match[2] ? (match[3] ? Number(match[3]) : Infinity) : Number(match[1]);
    return { repeating: max > 1, length: match[0].length, max };
  }
  return null;
}

/** Index just past the character class that starts at `index` (which holds `[`). */
function skipClass(pattern: string, index: number): number {
  let i = index + 1;
  while (i < pattern.length && pattern[i] !== ']') {
    i += pattern[i] === '\\' ? 2 : 1;
  }
  return i + 1;
}

interface Group {
  start: number;
  end: number;
  content: string;
  repeated: boolean;
}

/** Finds every parenthesised group together with whether a repeating quantifier follows it. */
function findGroups(pattern: string): Group[] {
  const groups: Group[] = [];
  const stack: number[] = [];
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 2;
    } else if (ch === '[') {
      i = skipClass(pattern, i);
    } else if (ch === '(') {
      stack.push(i);
      i += 1;
    } else if (ch === ')') {
      const start = stack.pop();
      if (start !== undefined) {
        const quantifier = readQuantifier(pattern, i + 1);
        groups.push({
          start,
          end: i,
          // Drop a group-type prefix such as `?:`, `?=` or `?<name>`.
          content: pattern
            .slice(start + 1, i)
            .replace(/^\?(?:[:=!]|<[=!]|<[A-Za-z_]\w*>)/, ''),
          repeated: !!quantifier?.repeating,
        });
      }
      i += 1;
    } else {
      i += 1;
    }
  }
  return groups;
}

/** True when `content` contains a repeating quantifier outside character classes. */
function hasRepeatingQuantifier(content: string): boolean {
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '\\') {
      i += 2;
    } else if (ch === '[') {
      i = skipClass(content, i);
    } else {
      const quantifier = readQuantifier(content, i);
      if (quantifier?.repeating) return true;
      i += quantifier ? quantifier.length : 1;
    }
  }
  return false;
}

/** Splits a group body on `|` characters that belong to it (not to nested groups or classes). */
function splitAlternatives(content: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '\\') {
      current += content.slice(i, i + 2);
      i += 2;
    } else if (ch === '[') {
      const end = skipClass(content, i);
      current += content.slice(i, end);
      i = end;
    } else {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (ch === '|' && depth === 0) {
        parts.push(current);
        current = '';
      } else {
        current += ch;
      }
      i += 1;
    }
  }
  parts.push(current);
  return parts;
}

/** What an alternative can start with: one literal, or 'any' for classes and wildcards. */
function startToken(alternative: string): string {
  if (alternative === '') return 'empty';
  const first = alternative[0];
  if (first === '.' || first === '[' || first === '(') return 'any';
  if (first === '\\') {
    const next = alternative[1] ?? '';
    return CLASS_ESCAPES.has(next) ? 'any' : `\\${next}`;
  }
  return first;
}

function alternativesOverlap(alternatives: string[]): boolean {
  const tokens = alternatives.map(startToken);
  if (tokens.some((t) => t === 'any' || t === 'empty')) return true;
  return new Set(tokens).size !== tokens.length;
}

/**
 * Looks for pattern shapes that are prone to catastrophic backtracking and
 * returns a short reason, or null when none was found. This is a conservative
 * static check (it can reject safe patterns); runtime evaluation is separately
 * time-boxed by {@link testPatternWithTimeout}.
 *
 * Rejected: a repeated group that itself contains a quantifier (`(a+)+`), a
 * repeated group with overlapping or empty alternatives (`(a|a)*`, `(a|ab)+`,
 * `(.|\d)*`), the same unbounded atom twice in a row (`\d+\d+`, `.*.*`), a
 * backreference, and very large counted repetitions (`{1,5000}`).
 */
export function findUnsafePatternReason(pattern: string): string | null {
  if (/\\[1-9]|\\k</.test(pattern)) return 'contains a backreference';

  for (const group of findGroups(pattern)) {
    if (!group.repeated) continue;
    if (hasRepeatingQuantifier(group.content)) return 'contains nested quantifiers';
    const alternatives = splitAlternatives(group.content);
    if (alternatives.length > 1 && alternativesOverlap(alternatives)) {
      return 'contains overlapping alternatives inside a repeated group';
    }
  }

  if (/(\.[*+]|\\[wWdDsS][*+]|\[(?:[^\]\\]|\\.)+\][*+]|[A-Za-z0-9][*+])\1/.test(pattern)) {
    return 'repeats the same unbounded element twice in a row';
  }

  const bound = /\{\d*,?(\d+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = bound.exec(pattern)) !== null) {
    if (Number(match[1]) > MAX_REPEAT_BOUND) return 'contains a very large repetition count';
  }
  return null;
}

// One reusable sandbox: the vm timeout aborts runaway regular expressions.
const sandbox = vm.createContext({ re: null as RegExp | null, value: '' });

/**
 * Tests `value` against `regex` but gives up after `timeoutMs`, so a pattern the
 * static check missed cannot block the event loop. Throws
 * {@link PatternTimeoutError} on timeout.
 */
export function testPatternWithTimeout(
  regex: RegExp,
  value: string,
  timeoutMs: number = PATTERN_TEST_TIMEOUT_MS,
): boolean {
  // Stateful flags would make repeated tests return different answers.
  const safe = new RegExp(regex.source, regex.flags.replace(/[gy]/g, ''));
  const context = sandbox as { re: RegExp | null; value: string };
  context.re = safe;
  context.value = value;
  try {
    return vm.runInContext('re.test(value)', sandbox, { timeout: timeoutMs }) as boolean;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      throw new PatternTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    context.re = null;
    context.value = '';
  }
}
