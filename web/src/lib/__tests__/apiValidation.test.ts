import { describe, it, expect } from 'vitest';
import {
  parseJsonBody,
  requireString,
  optionalString,
  requireObject,
  requireInteger,
  requireOneOf,
  parsePaginationParams,
} from '../apiValidation';

describe('parseJsonBody', () => {
  it('parses valid JSON object', async () => {
    const req = new Request('http://test', {
      method: 'POST',
      body: JSON.stringify({ name: 'test' }),
    });
    const result = await parseJsonBody(req);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.name).toBe('test');
  });

  it('rejects invalid JSON', async () => {
    const req = new Request('http://test', {
      method: 'POST',
      body: 'not json',
    });
    const result = await parseJsonBody(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });

  it('rejects arrays', async () => {
    const req = new Request('http://test', {
      method: 'POST',
      body: JSON.stringify([1, 2, 3]),
    });
    const result = await parseJsonBody(req);
    expect(result.ok).toBe(false);
  });

  it('rejects null body', async () => {
    const req = new Request('http://test', {
      method: 'POST',
      body: 'null',
    });
    const result = await parseJsonBody(req);
    expect(result.ok).toBe(false);
  });
});

describe('requireString', () => {
  it('accepts valid string', () => {
    const result = requireString('hello', 'name');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('hello');
  });

  it('trims whitespace', () => {
    const result = requireString('  hello  ', 'name');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('hello');
  });

  it('rejects undefined', () => {
    const result = requireString(undefined, 'name');
    expect(result.ok).toBe(false);
  });

  it('rejects null', () => {
    const result = requireString(null, 'name');
    expect(result.ok).toBe(false);
  });

  it('rejects numbers', () => {
    const result = requireString(42, 'name');
    expect(result.ok).toBe(false);
  });

  it('rejects empty string', () => {
    const result = requireString('', 'name');
    expect(result.ok).toBe(false);
  });

  it('rejects whitespace-only string', () => {
    const result = requireString('   ', 'name');
    expect(result.ok).toBe(false);
  });

  it('enforces maxLength', () => {
    const result = requireString('a'.repeat(201), 'name', { maxLength: 200 });
    expect(result.ok).toBe(false);
  });

  it('enforces minLength', () => {
    const result = requireString('ab', 'name', { minLength: 3 });
    expect(result.ok).toBe(false);
  });
});

describe('optionalString', () => {
  it('returns undefined for undefined input', () => {
    const result = optionalString(undefined, 'name');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeUndefined();
  });

  it('returns undefined for null input', () => {
    const result = optionalString(null, 'name');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeUndefined();
  });

  it('trims valid string', () => {
    const result = optionalString('  test  ', 'name');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('test');
  });

  it('rejects non-string values', () => {
    const result = optionalString(42, 'name');
    expect(result.ok).toBe(false);
  });

  it('enforces maxLength', () => {
    const result = optionalString('a'.repeat(501), 'name', { maxLength: 500 });
    expect(result.ok).toBe(false);
  });
});

describe('requireObject', () => {
  it('accepts valid object', () => {
    const result = requireObject({ key: 'value' }, 'data');
    expect(result.ok).toBe(true);
  });

  it('rejects null', () => {
    const result = requireObject(null, 'data');
    expect(result.ok).toBe(false);
  });

  it('rejects arrays', () => {
    const result = requireObject([1, 2], 'data');
    expect(result.ok).toBe(false);
  });

  it('rejects strings', () => {
    const result = requireObject('not object', 'data');
    expect(result.ok).toBe(false);
  });

  it('rejects undefined', () => {
    const result = requireObject(undefined, 'data');
    expect(result.ok).toBe(false);
  });
});

describe('requireInteger', () => {
  it('accepts valid integer', () => {
    const result = requireInteger(5, 'count');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(5);
  });

  it('accepts zero', () => {
    const result = requireInteger(0, 'count');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0);
  });

  it('rejects non-number', () => {
    const result = requireInteger('5', 'count');
    expect(result.ok).toBe(false);
  });

  it('rejects float', () => {
    const result = requireInteger(3.5, 'count');
    expect(result.ok).toBe(false);
  });

  it('enforces min', () => {
    const result = requireInteger(0, 'rating', { min: 1 });
    expect(result.ok).toBe(false);
  });

  it('enforces max', () => {
    const result = requireInteger(6, 'rating', { max: 5 });
    expect(result.ok).toBe(false);
  });

  it('accepts value within range', () => {
    const result = requireInteger(3, 'rating', { min: 1, max: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(3);
  });

  it('rejects undefined', () => {
    const result = requireInteger(undefined, 'count');
    expect(result.ok).toBe(false);
  });

  it('rejects null', () => {
    const result = requireInteger(null, 'count');
    expect(result.ok).toBe(false);
  });
});

describe('parsePaginationParams', () => {
  function makeParams(params: Record<string, string> = {}): URLSearchParams {
    return new URLSearchParams(params);
  }

  it('returns defaults when no params provided', () => {
    const result = parsePaginationParams(makeParams());
    expect(result).toEqual({ limit: 20, offset: 0 });
  });

  it('parses valid limit and offset', () => {
    const result = parsePaginationParams(makeParams({ limit: '10', offset: '30' }));
    expect(result).toEqual({ limit: 10, offset: 30 });
  });

  it('clamps limit to max 100', () => {
    const result = parsePaginationParams(makeParams({ limit: '9999' }));
    expect(result.limit).toBe(100);
  });

  it('clamps limit to min 1', () => {
    const result = parsePaginationParams(makeParams({ limit: '0' }));
    expect(result.limit).toBe(1);
  });

  it('clamps negative limit to 1', () => {
    const result = parsePaginationParams(makeParams({ limit: '-5' }));
    expect(result.limit).toBe(1);
  });

  it('clamps negative offset to 0', () => {
    const result = parsePaginationParams(makeParams({ offset: '-10' }));
    expect(result.offset).toBe(0);
  });

  it('falls back to default on non-numeric limit', () => {
    const result = parsePaginationParams(makeParams({ limit: 'abc' }));
    expect(result.limit).toBe(20);
  });

  it('falls back to 0 on non-numeric offset', () => {
    const result = parsePaginationParams(makeParams({ offset: 'abc' }));
    expect(result.offset).toBe(0);
  });

  it('respects custom defaultLimit', () => {
    const result = parsePaginationParams(makeParams(), { defaultLimit: 50 });
    expect(result.limit).toBe(50);
  });

  it('respects custom maxLimit', () => {
    const result = parsePaginationParams(makeParams({ limit: '200' }), { maxLimit: 50 });
    expect(result.limit).toBe(50);
  });
});

describe('requireOneOf', () => {
  const TYPES = ['bug', 'feature', 'general'] as const;

  it('accepts valid value', () => {
    const result = requireOneOf('bug', 'type', TYPES);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('bug');
  });

  it('rejects invalid value', () => {
    const result = requireOneOf('invalid', 'type', TYPES);
    expect(result.ok).toBe(false);
  });

  it('rejects undefined', () => {
    const result = requireOneOf(undefined, 'type', TYPES);
    expect(result.ok).toBe(false);
  });

  it('rejects null', () => {
    const result = requireOneOf(null, 'type', TYPES);
    expect(result.ok).toBe(false);
  });
});
