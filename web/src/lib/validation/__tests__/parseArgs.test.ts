import { describe, it, expect } from 'vitest';
import { parseHandlerArgs } from '../parseArgs';
import { entityId, boundedString, positiveNumber, enumValue, finiteNumber, boolean } from '../validators';

describe('parseHandlerArgs', () => {
  it('parses valid required fields', () => {
    const result = parseHandlerArgs(
      { entityId: 'abc-123', name: 'Player' },
      {
        entityId: { validate: entityId() },
        name: { validate: boundedString(1, 128) },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ entityId: 'abc-123', name: 'Player' });
  });

  it('returns error for missing required field', () => {
    const result = parseHandlerArgs(
      { name: 'Player' },
      {
        entityId: { validate: entityId() },
        name: { validate: boundedString(1, 128) },
      },
    );
    expect(result.data).toBeUndefined();
    expect(result.error).not.toBeUndefined();
    expect(result.error!.success).toBe(false);
    expect(result.error!.error).toContain('entityId');
    expect(result.error!.error).toContain('required');
  });

  it('allows optional fields to be absent', () => {
    const result = parseHandlerArgs(
      { entityId: 'abc' },
      {
        entityId: { validate: entityId() },
        name: { validate: boundedString(1, 128), optional: true },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ entityId: 'abc' });
    expect(result.data!.name).toBeUndefined();
  });

  it('validates optional fields when present', () => {
    const result = parseHandlerArgs(
      { entityId: 'abc', name: '' },
      {
        entityId: { validate: entityId() },
        name: { validate: boundedString(1, 128), optional: true },
      },
    );
    expect(result.error).not.toBeUndefined();
    expect(result.error!.error).toContain('name');
  });

  it('collects multiple errors', () => {
    const result = parseHandlerArgs(
      { entityId: '', speed: -1 },
      {
        entityId: { validate: entityId() },
        speed: { validate: positiveNumber() },
      },
    );
    expect(result.error).not.toBeUndefined();
    expect(result.error!.error).toContain('entityId');
    expect(result.error!.error).toContain('speed');
  });

  it('returns ExecutionResult shape on error', () => {
    const result = parseHandlerArgs(
      {},
      { entityId: { validate: entityId() } },
    );
    expect(result.error).toMatchObject({
      success: false,
      error: expect.stringContaining('Invalid arguments'),
    });
  });

  it('handles enum validation', () => {
    const modes = ['translate', 'rotate', 'scale'] as const;
    const result = parseHandlerArgs(
      { mode: 'translate' },
      { mode: { validate: enumValue(modes) } },
    );
    expect(result.data).toEqual({ mode: 'translate' });
  });

  it('rejects invalid enum value', () => {
    const modes = ['translate', 'rotate', 'scale'] as const;
    const result = parseHandlerArgs(
      { mode: 'fly' },
      { mode: { validate: enumValue(modes) } },
    );
    expect(result.error).not.toBeUndefined();
    expect(result.error!.error).toContain('must be one of');
  });

  it('handles null as missing for required fields', () => {
    const result = parseHandlerArgs(
      { entityId: null },
      { entityId: { validate: entityId() } },
    );
    expect(result.error).not.toBeUndefined();
    expect(result.error!.error).toContain('required');
  });

  it('handles null as missing for optional fields', () => {
    const result = parseHandlerArgs(
      { entityId: 'abc', name: null },
      {
        entityId: { validate: entityId() },
        name: { validate: boundedString(1, 128), optional: true },
      },
    );
    expect(result.error).toBeUndefined();
  });

  it('handles empty schema', () => {
    const result = parseHandlerArgs({ foo: 'bar' }, {});
    expect(result.data).toEqual({});
    expect(result.error).toBeUndefined();
  });

  it('works with finiteNumber validator', () => {
    const result = parseHandlerArgs(
      { x: 3.14, y: -2 },
      {
        x: { validate: finiteNumber() },
        y: { validate: finiteNumber() },
      },
    );
    expect(result.data).toEqual({ x: 3.14, y: -2 });
  });

  it('works with boolean validator', () => {
    const result = parseHandlerArgs(
      { enabled: true },
      { enabled: { validate: boolean() } },
    );
    expect(result.data).toEqual({ enabled: true });
  });

  it('rejects wrong type for boolean field', () => {
    const result = parseHandlerArgs(
      { enabled: 'yes' },
      { enabled: { validate: boolean() } },
    );
    expect(result.error).not.toBeUndefined();
  });
});
