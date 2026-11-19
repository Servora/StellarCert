import {
  findUnsafePatternReason,
  PatternTimeoutError,
  testPatternWithTimeout,
} from './safe-pattern.util';
import { assertSafePattern } from './metadata-schema.service';

describe('findUnsafePatternReason', () => {
  it.each([
    ['(a+)+$', 'nested quantifiers'],
    ['^(\\d+)*$', 'nested quantifiers'],
    ['^(\\w+\\s?)+$', 'nested quantifiers'],
    ['^(.*)*$', 'nested quantifiers'],
    ['^(a|a)*b$', 'overlapping alternatives'],
    ['^(a|ab)+c$', 'overlapping alternatives'],
    ['^(\\d|\\w)+$', 'overlapping alternatives'],
    ['^(.|x)*$', 'overlapping alternatives'],
    ['^(a|)+$', 'overlapping alternatives'],
    ['^(?:a|a)*b$', 'overlapping alternatives'],
    ['^\\d+\\d+$', 'twice in a row'],
    ['^.*.*x$', 'twice in a row'],
    ['^[a-z]+[a-z]+$', 'twice in a row'],
    ['^(a)\\1+$', 'backreference'],
    ['^a{1,5000}$', 'very large repetition'],
  ])('rejects %s', (pattern, reason) => {
    expect(findUnsafePatternReason(pattern)).toContain(reason);
  });

  it.each([
    '^[A-Z]{2}\\d{6}$',
    '^CERT-\\d{4}$',
    '^[a-z0-9-]+$',
    '^\\d{4}-\\d{2}-\\d{2}$',
    '^(foo|bar)+$',
    '^(?:foo|bar|baz)$',
    '^(\\d{3}-)?\\d{4}$',
    '^[^@\\s]+@[^@\\s]+$',
    '^(?:\\+?\\d{1,3})?\\d{10}$',
  ])('accepts %s', (pattern) => {
    expect(findUnsafePatternReason(pattern)).toBeNull();
  });
});

describe('assertSafePattern', () => {
  it('keeps the existing messages and now covers alternation blowups', () => {
    expect(() => assertSafePattern('code', '(a+)+$')).toThrow(
      'Pattern for field "code" contains nested quantifiers and is not allowed',
    );
    expect(() => assertSafePattern('code', '^(a|a)*b$')).toThrow(
      /overlapping alternatives inside a repeated group and is not allowed/,
    );
    expect(() => assertSafePattern('code', '(')).toThrow(/not a valid regular expression/);
    expect(assertSafePattern('code', '^CERT-\\d{4}$').test('CERT-1234')).toBe(true);
  });
});

describe('testPatternWithTimeout', () => {
  it('returns the match result for ordinary patterns', () => {
    expect(testPatternWithTimeout(/^CERT-\d{4}$/, 'CERT-1234')).toBe(true);
    expect(testPatternWithTimeout(/^CERT-\d{4}$/, 'nope')).toBe(false);
  });

  it('ignores global/sticky flags so repeated calls give the same answer', () => {
    const regex = /abc/g;
    expect(testPatternWithTimeout(regex, 'abc')).toBe(true);
    expect(testPatternWithTimeout(regex, 'abc')).toBe(true);
    expect(regex.lastIndex).toBe(0);
  });

  it('aborts a catastrophic pattern that the static check would miss', () => {
    const evil = new RegExp('^(a+)+$'); // built directly, bypassing assertSafePattern
    const started = Date.now();

    expect(() => testPatternWithTimeout(evil, `${'a'.repeat(40)}!`, 50)).toThrow(PatternTimeoutError);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('keeps working after a timeout', () => {
    const evil = new RegExp('^(a+)+$');
    expect(() => testPatternWithTimeout(evil, `${'a'.repeat(40)}!`, 50)).toThrow(PatternTimeoutError);
    expect(testPatternWithTimeout(/^a+$/, 'aaa')).toBe(true);
  });
});
