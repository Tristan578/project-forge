import { describe, it, expect } from 'vitest';
import {
  parseJsonBody,
  requireString,
  optionalString,
  requireObject,
  requireOneOf,
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
