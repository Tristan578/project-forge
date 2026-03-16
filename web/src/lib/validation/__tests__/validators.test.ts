import { describe, it, expect } from 'vitest';
import {
  validateEntityId,
  validateBoundedString,
  validatePositiveNumber,
  validateFiniteNumber,
  validateEnum,
  validateRequired,
  validateBoolean,
  validateNumberInRange,
  validateArray,
  entityId,
  boundedString,
  positiveNumber,
  finiteNumber,
  enumValue,
  required,
  boolean,
  numberInRange,
  array,
} from '../validators';

// ===== validateEntityId =====

describe('validateEntityId', () => {
  it('accepts a valid entity ID', () => {
    const r = validateEntityId('abc-123');
    expect(r).toEqual({ valid: true, value: 'abc-123' });
  });

  it('rejects non-string values', () => {
    const r = validateEntityId(42);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toContain('must be a string');
  });

  it('rejects empty strings', () => {
    const r = validateEntityId('');
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toContain('must not be empty');
  });

  it('rejects strings longer than 256 characters', () => {
    const r = validateEntityId('a'.repeat(257));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toContain('exceeds maximum length');
  });

  it('accepts strings exactly 256 characters long', () => {
    const r = validateEntityId('a'.repeat(256));
    expect(r.valid).toBe(true);
  });

  it('uses custom field name in error', () => {
    const r = validateEntityId(null, 'targetId');
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.field).toBe('targetId');
  });

  it('rejects null', () => {
    const r = validateEntityId(null);
    expect(r.valid).toBe(false);
  });

  it('rejects undefined', () => {
    const r = validateEntityId(undefined);
    expect(r.valid).toBe(false);
  });
});

// ===== validateBoundedString =====

describe('validateBoundedString', () => {
  it('accepts a string within bounds', () => {
    const r = validateBoundedString('hello', 1, 10);
    expect(r).toEqual({ valid: true, value: 'hello' });
  });

  it('rejects string below minimum', () => {
    const r = validateBoundedString('', 1, 10);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toContain('at least 1');
  });

  it('rejects string above maximum', () => {
    const r = validateBoundedString('toolong', 1, 3);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toContain('at most 3');
  });

  it('accepts string at exact minimum', () => {
    expect(validateBoundedString('a', 1, 5).valid).toBe(true);
  });

  it('accepts string at exact maximum', () => {
    expect(validateBoundedString('abcde', 1, 5).valid).toBe(true);
  });

  it('rejects non-string values', () => {
    const r = validateBoundedString(123, 1, 10);
    expect(r.valid).toBe(false);
  });

  it('includes field name in error', () => {
    const r = validateBoundedString(true, 1, 10, 'name');
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.field).toBe('name');
  });
});

// ===== validatePositiveNumber =====

describe('validatePositiveNumber', () => {
  it('accepts a positive number', () => {
    expect(validatePositiveNumber(5)).toEqual({ valid: true, value: 5 });
  });

  it('accepts a small positive number', () => {
    expect(validatePositiveNumber(0.001).valid).toBe(true);
  });

  it('rejects zero', () => {
    const r = validatePositiveNumber(0);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toContain('greater than 0');
  });

  it('rejects negative numbers', () => {
    expect(validatePositiveNumber(-1).valid).toBe(false);
  });

  it('rejects Infinity', () => {
    expect(validatePositiveNumber(Infinity).valid).toBe(false);
  });

  it('rejects NaN', () => {
    expect(validatePositiveNumber(NaN).valid).toBe(false);
  });

  it('rejects non-number types', () => {
    expect(validatePositiveNumber('5').valid).toBe(false);
  });
});

// ===== validateFiniteNumber =====

describe('validateFiniteNumber', () => {
  it('accepts zero', () => {
    expect(validateFiniteNumber(0)).toEqual({ valid: true, value: 0 });
  });

  it('accepts negative numbers', () => {
    expect(validateFiniteNumber(-42).valid).toBe(true);
  });

  it('rejects Infinity', () => {
    expect(validateFiniteNumber(Infinity).valid).toBe(false);
  });

  it('rejects -Infinity', () => {
    expect(validateFiniteNumber(-Infinity).valid).toBe(false);
  });

  it('rejects NaN', () => {
    expect(validateFiniteNumber(NaN).valid).toBe(false);
  });

  it('rejects strings', () => {
    expect(validateFiniteNumber('3.14').valid).toBe(false);
  });
});

// ===== validateEnum =====

describe('validateEnum', () => {
  const modes = ['translate', 'rotate', 'scale'] as const;

  it('accepts a valid enum value', () => {
    expect(validateEnum('rotate', modes)).toEqual({ valid: true, value: 'rotate' });
  });

  it('rejects an invalid enum value', () => {
    const r = validateEnum('fly', modes);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toContain('must be one of');
  });

  it('rejects non-string types', () => {
    expect(validateEnum(1, modes).valid).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(validateEnum('Translate', modes).valid).toBe(false);
  });

  it('lists allowed values in error', () => {
    const r = validateEnum('bad', modes);
    if (!r.valid) {
      expect(r.error).toContain('translate');
      expect(r.error).toContain('rotate');
      expect(r.error).toContain('scale');
    }
  });
});

// ===== validateRequired =====

describe('validateRequired', () => {
  it('accepts truthy values', () => {
    expect(validateRequired('hello').valid).toBe(true);
    expect(validateRequired(0).valid).toBe(true);
    expect(validateRequired(false).valid).toBe(true);
    expect(validateRequired('').valid).toBe(true);
  });

  it('rejects null', () => {
    const r = validateRequired(null, 'config');
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(r.error).toContain('required');
      expect(r.field).toBe('config');
    }
  });

  it('rejects undefined', () => {
    expect(validateRequired(undefined).valid).toBe(false);
  });
});

// ===== validateBoolean =====

describe('validateBoolean', () => {
  it('accepts true', () => {
    expect(validateBoolean(true)).toEqual({ valid: true, value: true });
  });

  it('accepts false', () => {
    expect(validateBoolean(false)).toEqual({ valid: true, value: false });
  });

  it('rejects truthy non-booleans', () => {
    expect(validateBoolean(1).valid).toBe(false);
    expect(validateBoolean('true').valid).toBe(false);
  });
});

// ===== validateNumberInRange =====

describe('validateNumberInRange', () => {
  it('accepts number within range', () => {
    expect(validateNumberInRange(5, 0, 10)).toEqual({ valid: true, value: 5 });
  });

  it('accepts number at min boundary', () => {
    expect(validateNumberInRange(0, 0, 10).valid).toBe(true);
  });

  it('accepts number at max boundary', () => {
    expect(validateNumberInRange(10, 0, 10).valid).toBe(true);
  });

  it('rejects number below range', () => {
    const r = validateNumberInRange(-1, 0, 10);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toContain('between 0 and 10');
  });

  it('rejects number above range', () => {
    expect(validateNumberInRange(11, 0, 10).valid).toBe(false);
  });

  it('rejects non-numbers', () => {
    expect(validateNumberInRange('5', 0, 10).valid).toBe(false);
  });

  it('rejects NaN', () => {
    expect(validateNumberInRange(NaN, 0, 10).valid).toBe(false);
  });
});

// ===== validateArray =====

describe('validateArray', () => {
  it('accepts valid array', () => {
    const r = validateArray(['a', 'b'], (v, f) => validateEntityId(v, f));
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.value).toEqual(['a', 'b']);
  });

  it('accepts empty array', () => {
    const r = validateArray([], (v, f) => validateEntityId(v, f));
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.value).toEqual([]);
  });

  it('rejects non-array', () => {
    const r = validateArray('not-array', (v, f) => validateEntityId(v, f));
    expect(r.valid).toBe(false);
  });

  it('rejects array with invalid element', () => {
    const r = validateArray(['valid', 42], (v, f) => validateEntityId(v, f));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.field).toContain('[1]');
  });
});

// ===== Factory helpers =====

describe('factory helpers', () => {
  it('entityId() creates a working validator', () => {
    const v = entityId();
    expect(v('abc', 'id').valid).toBe(true);
    expect(v('', 'id').valid).toBe(false);
  });

  it('boundedString() creates a working validator', () => {
    const v = boundedString(2, 5);
    expect(v('abc', 'name').valid).toBe(true);
    expect(v('a', 'name').valid).toBe(false);
  });

  it('positiveNumber() creates a working validator', () => {
    const v = positiveNumber();
    expect(v(3, 'count').valid).toBe(true);
    expect(v(0, 'count').valid).toBe(false);
  });

  it('finiteNumber() creates a working validator', () => {
    const v = finiteNumber();
    expect(v(0, 'x').valid).toBe(true);
    expect(v(Infinity, 'x').valid).toBe(false);
  });

  it('enumValue() creates a working validator', () => {
    const v = enumValue(['a', 'b'] as const);
    expect(v('a', 'mode').valid).toBe(true);
    expect(v('c', 'mode').valid).toBe(false);
  });

  it('required() creates a working validator', () => {
    const v = required();
    expect(v('x', 'field').valid).toBe(true);
    expect(v(null, 'field').valid).toBe(false);
  });

  it('boolean() creates a working validator', () => {
    const v = boolean();
    expect(v(true, 'flag').valid).toBe(true);
    expect(v(1, 'flag').valid).toBe(false);
  });

  it('numberInRange() creates a working validator', () => {
    const v = numberInRange(0, 1);
    expect(v(0.5, 'alpha').valid).toBe(true);
    expect(v(2, 'alpha').valid).toBe(false);
  });

  it('array() creates a working validator', () => {
    const v = array(entityId());
    expect(v(['a', 'b'], 'ids').valid).toBe(true);
    expect(v([1], 'ids').valid).toBe(false);
  });
});
