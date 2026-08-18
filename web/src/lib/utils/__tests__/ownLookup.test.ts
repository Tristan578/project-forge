import { describe, it, expect } from 'vitest';

import { lookupOwn, hasOwnKey } from '../ownLookup';

/**
 * The names that make a bare `map[id]` unsafe. Each of these resolves to
 * something off `Object.prototype`, and every one of those values is truthy —
 * which is what defeats the `if (!thing) return notFound` guard these lookups
 * are wrapped in throughout the codebase.
 */
const PROTOTYPE_NAMES = [
  '__proto__',
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
] as const;

describe('the trap these helpers exist for', () => {
  it.each(PROTOTYPE_NAMES)('a bare read of %s is truthy on an empty map', (name) => {
    const empty: Record<string, unknown> = {};
    // Not an assertion about our code — an assertion about the language, so the
    // premise the helpers rest on fails loudly if it ever stops holding.
    expect(empty[name]).toBeTruthy();
  });
});

describe('lookupOwn', () => {
  it.each(PROTOTYPE_NAMES)('returns undefined for %s on an empty map', (name) => {
    expect(lookupOwn({}, name)).toBeUndefined();
  });

  it.each(PROTOTYPE_NAMES)('returns undefined for %s on a populated map', (name) => {
    expect(lookupOwn({ real: 1 }, name)).toBeUndefined();
  });

  it('finds an own key', () => {
    expect(lookupOwn({ tree: 'value' }, 'tree')).toBe('value');
  });

  it('finds a key that is genuinely named after a prototype member', () => {
    // The point is to reject INHERITED lookups, not unusual names. A user who
    // names a dialogue tree `__proto__` still finds it.
    const map = Object.create(null) as Record<string, string>;
    map['__proto__'] = 'a real entry';
    expect(lookupOwn(map, '__proto__')).toBe('a real entry');
  });

  it('finds an own key whose stored value is falsy', () => {
    // Distinguishes "absent" from "present but empty" at the helper's boundary,
    // even though callers collapse both with `if (!x)`.
    expect(lookupOwn({ zero: 0 }, 'zero')).toBe(0);
    expect(lookupOwn({ blank: '' }, 'blank')).toBe('');
  });

  it('returns undefined rather than throwing on an absent map', () => {
    expect(lookupOwn(undefined, 'anything')).toBeUndefined();
    expect(lookupOwn(null, 'anything')).toBeUndefined();
  });

  it('returns undefined for a non-string key', () => {
    // Call sites hold `string | null` ids (a nulled selection, an unset active
    // tree) and would otherwise have to null-check ahead of every lookup.
    expect(lookupOwn({ a: 1 }, null)).toBeUndefined();
    expect(lookupOwn({ a: 1 }, undefined)).toBeUndefined();
  });

  it('does not find a key inherited from a prototype the map was built on', () => {
    const parent = { inherited: 'from parent' };
    const child = Object.create(parent) as Record<string, string>;
    child.own = 'from child';

    expect(child.inherited).toBe('from parent');
    expect(lookupOwn(child, 'inherited')).toBeUndefined();
    expect(lookupOwn(child, 'own')).toBe('from child');
  });
});

describe('hasOwnKey', () => {
  it.each(PROTOTYPE_NAMES)('is false for %s', (name) => {
    expect(hasOwnKey({}, name)).toBe(false);
  });

  it('is true for an own key', () => {
    expect(hasOwnKey({ tree: 1 }, 'tree')).toBe(true);
  });

  it('is true for an own key holding undefined', () => {
    // The membership half exists for exactly this: through `lookupOwn` a stored
    // `undefined` is indistinguishable from an absent key.
    expect(hasOwnKey({ set: undefined }, 'set')).toBe(true);
    expect(lookupOwn({ set: undefined }, 'set')).toBeUndefined();
  });

  it('is false for an absent map or a non-string key', () => {
    expect(hasOwnKey(undefined, 'a')).toBe(false);
    expect(hasOwnKey(null, 'a')).toBe(false);
    expect(hasOwnKey({ a: 1 }, null)).toBe(false);
  });
});
