import { describe, it, expect } from 'vitest';
import { omitUndefinedValues } from '../omitUndefined';
import { z } from 'zod';

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

  it('keeps an own __proto__ key as data and never grafts it onto the prototype', () => {
    // JSON.parse creates `__proto__` as an OWN property; copying that key by
    // plain assignment would call the prototype setter instead.
    const input = JSON.parse('{"__proto__":{"bodyType":"static"},"friction":0.9}') as Record<string, unknown>;
    const result = omitUndefinedValues(input) as Record<string, unknown>;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result.bodyType).toBeUndefined();
    expect(Object.keys(result).sort()).toEqual(['__proto__', 'friction']);
  });

  // Pins the docblock's zod claim: absent input keys stay absent, but an input
  // key present with `undefined` survives `.parse()` as an own key, so a raw
  // spread of the parsed object WOULD erase the stored value.
  it('strips the explicit-undefined key that survives a zod .optional() parse', () => {
    const schema = z.object({ a: z.number().optional(), b: z.number().optional() });
    expect(Object.hasOwn(schema.parse({}), 'a')).toBe(false);
    const parsed = schema.parse({ a: undefined, b: 2 });
    expect(Object.hasOwn(parsed, 'a')).toBe(true);

    const existing = { a: 1, b: 1 };
    expect({ ...existing, ...parsed }).toStrictEqual({ a: undefined, b: 2 });
    expect({ ...existing, ...omitUndefinedValues(parsed) }).toStrictEqual({ a: 1, b: 2 });
  });

  it('safely merges over an existing full record without overwriting with undefined', () => {
    const existing = { bodyType: 'dynamic' as const, friction: 0.5 };
    const partialUpdate: { bodyType?: 'dynamic' | 'static'; friction?: number } = { friction: 0.9 };
    const merged = { ...existing, ...omitUndefinedValues(partialUpdate) };
    expect(merged).toStrictEqual({ bodyType: 'dynamic', friction: 0.9 });
  });
});
