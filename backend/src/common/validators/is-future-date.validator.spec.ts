import { IsFutureDateConstraint } from './is-future-date.validator';

describe('IsFutureDateConstraint (#1247)', () => {
  const constraint = new IsFutureDateConstraint();

  it('accepts undefined and null (field is optional)', () => {
    expect(constraint.validate(undefined)).toBe(true);
    expect(constraint.validate(null)).toBe(true);
  });

  it('rejects a Date instance in the past', () => {
    expect(constraint.validate(new Date('2000-01-01T00:00:00Z'))).toBe(false);
  });

  it('rejects an ISO date string in the past', () => {
    expect(constraint.validate('2000-01-01T00:00:00Z')).toBe(false);
  });

  it('accepts a Date instance in the future', () => {
    expect(constraint.validate(new Date('2999-01-01T00:00:00Z'))).toBe(true);
  });

  it('accepts an ISO date string in the future', () => {
    expect(constraint.validate('2999-01-01T00:00:00Z')).toBe(true);
  });

  it('rejects an unparsable value', () => {
    expect(constraint.validate('not-a-date')).toBe(false);
  });

  it('builds a message naming the offending property', () => {
    const message = constraint.defaultMessage({
      property: 'expiresAt',
    } as any);
    expect(message).toBe('expiresAt must be a date in the future');
  });
});
