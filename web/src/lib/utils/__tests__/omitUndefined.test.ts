import { describe, it, expect } from 'vitest';
import { omitUndefinedValues } from '../omitUndefined';

describe('omitUndefinedValues', () => {
  it('drops keys whose value is explicitly undefined', () => {
    const input = { a: 1, b: undefined, c: 'x' };
    expect(omitUndefinedValues(input)).toStrictEqual({ a: 1, c: 'x' });
  });

  it('never adds a key that was absent', () => {
    const input: { a: number; b?: number } = { a: 1 };
    const result = omitUndefinedValues(input);
    expect('b' in result).toBe(false);
    expect(Object.keys(result)).toEqual(['a']);
  });

  it('keeps falsy-but-defined values (0, "", false, null)', () => {
    const input = { zero: 0, empty: '', bool: false, nil: null };
    expect(omitUndefinedValues(input)).toStrictEqual({ zero: 0, empty: '', bool: false, nil: null });
  });

  it('returns an empty object for an all-undefined input', () => {
    expect(omitUndefinedValues({ a: undefined, b: undefined })).toStrictEqual({});
  });

  it('does not mutate the input object', () => {
    const input = { a: 1, b: undefined as number | undefined };
    const result = omitUndefinedValues(input);
    expect(result).not.toBe(input);
    expect('b' in input).toBe(true);
  });

  it('safely merges over an existing full record without overwriting with undefined', () => {
    const existing = { bodyType: 'dynamic' as const, friction: 0.5 };
    const partialUpdate: { bodyType?: 'dynamic' | 'static'; friction?: number } = { friction: 0.9 };
    const merged = { ...existing, ...omitUndefinedValues(partialUpdate) };
    expect(merged).toStrictEqual({ bodyType: 'dynamic', friction: 0.9 });
  });
});
