/**
 * Pins `ownEntry`, the prototype-pollution guard behind the record reads in the
 * handler modules (~30 of them in `handlers2d.ts` alone).
 *
 * It lives here rather than beside the `helpers` suite because anyone deciding
 * whether that guard is safe to change looks for the test file named after the
 * module it guards.
 */

import { describe, it, expect } from 'vitest';
import { ownEntry } from '../types';

describe('ownEntry', () => {
  it('returns an own value', () => {
    expect(ownEntry({ a: 1 }, 'a')).toBe(1);
  });

  it('returns undefined for an absent key', () => {
    expect(ownEntry({ a: 1 }, 'b')).toBeUndefined();
  });

  it.each(['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty'])(
    'returns undefined for the inherited key %s',
    (key) => {
      const record: Record<string, { bodyType: string }> = {};
      // A bare `record[key]` here resolves to `Object.prototype` or a function.
      // Both are TRUTHY, so `?? defaults()` never falls back and
      // `if (!data) return error` never reports the entity missing (PF-1167).
      expect(record[key]).toBeTruthy();
      expect(ownEntry(record, key)).toBeUndefined();
    },
  );

  it('returns an own key that happens to be named __proto__', () => {
    // `{ __proto__: v }` sets the prototype rather than an own key, so this is
    // the only way such a record arises — and it does arise, from any parsed
    // JSON (an imported scene, an LLM tool argument).
    const record = JSON.parse('{"__proto__": {"bodyType": "static"}}') as Record<
      string,
      { bodyType: string }
    >;
    expect(ownEntry(record, '__proto__')).toEqual({ bodyType: 'static' });
  });

  it.each([
    ['zero', 0],
    ['empty string', ''],
    ['false', false],
    ['null', null],
  ])('distinguishes a present-but-falsy value (%s) from an absent one', (_label, value) => {
    // A truthiness check on the result would collapse these into "missing".
    expect(ownEntry({ a: value } as Record<string, unknown>, 'a')).toBe(value);
  });

  it('reads from a null-prototype record', () => {
    const record = Object.create(null) as Record<string, number>;
    record.a = 1;
    expect(ownEntry(record, 'a')).toBe(1);
    expect(ownEntry(record, '__proto__')).toBeUndefined();
  });
});
