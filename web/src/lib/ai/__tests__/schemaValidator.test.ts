import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  validateCommandResponse,
  validateBuiltInCommand,
  validateOrWarn,
  BUILT_IN_SCHEMAS,
} from '../schemaValidator';
import type { SchemaDefinition } from '../schemaValidator';

// ---------------------------------------------------------------------------
// validateCommandResponse — generic schema validation
// ---------------------------------------------------------------------------

describe('validateCommandResponse', () => {
  const schema: SchemaDefinition = {
    name: 'test_command',
    fields: {
      entityId: { type: 'string', required: true },
      value: { type: 'number', required: true, min: 0, max: 100 },
      flag: { type: 'boolean', required: false },
      tags: { type: 'array', required: false },
    },
  };

  it('validates a correct object', () => {
    const result = validateCommandResponse(
      { entityId: 'abc', value: 50 },
      schema
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports missing required field', () => {
    const result = validateCommandResponse({ value: 50 }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('entityId'))).toBe(true);
  });

  it('reports wrong type', () => {
    const result = validateCommandResponse({ entityId: 123, value: 50 }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('entityId'))).toBe(true);
  });

  it('reports number below minimum', () => {
    const result = validateCommandResponse({ entityId: 'abc', value: -5 }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('>='))).toBe(true);
  });

  it('reports number above maximum', () => {
    const result = validateCommandResponse({ entityId: 'abc', value: 200 }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('<='))).toBe(true);
  });

  it('accepts optional field when present and correct', () => {
    const result = validateCommandResponse(
      { entityId: 'abc', value: 50, flag: true },
      schema
    );
    expect(result.valid).toBe(true);
  });

  it('does not error on missing optional field', () => {
    const result = validateCommandResponse({ entityId: 'abc', value: 50 }, schema);
    expect(result.valid).toBe(true);
  });

  it('rejects non-object input', () => {
    const result = validateCommandResponse('not an object', schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('plain object');
  });

  it('rejects array input', () => {
    const result = validateCommandResponse([], schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('plain object');
  });

  it('rejects null input', () => {
    const result = validateCommandResponse(null, schema);
    expect(result.valid).toBe(false);
  });

  it('collects multiple errors', () => {
    const result = validateCommandResponse({}, schema);
    expect(result.errors.length).toBeGreaterThan(1);
  });

  // Array field type check
  it('validates array field type', () => {
    const result = validateCommandResponse(
      { entityId: 'abc', value: 10, tags: 'notanarray' },
      schema
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('array'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Enum validation
// ---------------------------------------------------------------------------

describe('validateCommandResponse — enum fields', () => {
  const schema: SchemaDefinition = {
    name: 'material_cmd',
    fields: {
      alphaMode: { type: 'string', required: false, enum: ['opaque', 'transparent'] },
    },
  };

  it('accepts a valid enum value', () => {
    expect(validateCommandResponse({ alphaMode: 'opaque' }, schema).valid).toBe(true);
  });

  it('rejects an invalid enum value', () => {
    const result = validateCommandResponse({ alphaMode: 'invalid' }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('one of'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Nested object / array items
// ---------------------------------------------------------------------------

describe('validateCommandResponse — nested schemas', () => {
  const schema: SchemaDefinition = {
    name: 'nested_cmd',
    fields: {
      metadata: {
        type: 'object',
        required: false,
        properties: {
          label: { type: 'string', required: true },
        },
      },
      coords: {
        type: 'array',
        required: false,
        items: { type: 'number', required: true },
      },
    },
  };

  it('validates nested object property', () => {
    const result = validateCommandResponse({ metadata: { label: 'hello' } }, schema);
    expect(result.valid).toBe(true);
  });

  it('reports nested object property type mismatch', () => {
    const result = validateCommandResponse({ metadata: { label: 42 } }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('metadata.label'))).toBe(true);
  });

  it('reports nested required field missing', () => {
    const result = validateCommandResponse({ metadata: {} }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('label'))).toBe(true);
  });

  it('validates array items type', () => {
    const result = validateCommandResponse({ coords: [1, 2, 'three'] }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('coords[2]'))).toBe(true);
  });

  it('accepts correct array items', () => {
    const result = validateCommandResponse({ coords: [1, 2, 3] }, schema);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateBuiltInCommand — built-in schemas
// ---------------------------------------------------------------------------

describe('validateBuiltInCommand', () => {
  it('returns valid for unknown command (graceful degradation)', () => {
    const result = validateBuiltInCommand('unknown_command', { anything: 'goes' });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates spawn_entity correctly', () => {
    const result = validateBuiltInCommand('spawn_entity', { entityType: 'cube' });
    expect(result.valid).toBe(true);
  });

  it('rejects spawn_entity with invalid entityType', () => {
    const result = validateBuiltInCommand('spawn_entity', { entityType: 'invalid_type' });
    expect(result.valid).toBe(false);
  });

  it('rejects spawn_entity when entityType missing', () => {
    const result = validateBuiltInCommand('spawn_entity', { name: 'Test' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('entityType'))).toBe(true);
  });

  it('validates set_material with all fields', () => {
    const result = validateBuiltInCommand('set_material', {
      entityId: 'e1',
      metallic: 0.5,
      roughness: 0.3,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects set_material when metallic out of range', () => {
    const result = validateBuiltInCommand('set_material', {
      entityId: 'e1',
      metallic: 2.0,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('metallic'))).toBe(true);
  });

  it('validates update_transform correctly', () => {
    const result = validateBuiltInCommand('update_transform', {
      entityId: 'e1',
      position: [0, 1, 0],
    });
    expect(result.valid).toBe(true);
  });

  it('validates set_physics bodyType enum', () => {
    const result = validateBuiltInCommand('set_physics', {
      entityId: 'e1',
      bodyType: 'dynamic',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects set_physics invalid bodyType', () => {
    const result = validateBuiltInCommand('set_physics', {
      entityId: 'e1',
      bodyType: 'notvalid',
    });
    expect(result.valid).toBe(false);
  });

  it('validates set_script correctly', () => {
    const result = validateBuiltInCommand('set_script', {
      entityId: 'e1',
      code: 'function onUpdate() {}',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects set_script when code missing', () => {
    const result = validateBuiltInCommand('set_script', { entityId: 'e1' });
    expect(result.valid).toBe(false);
  });

  it('validates delete_entity correctly', () => {
    const result = validateBuiltInCommand('delete_entity', { entityId: 'e1' });
    expect(result.valid).toBe(true);
  });

  it('validates rename_entity correctly', () => {
    const result = validateBuiltInCommand('rename_entity', { entityId: 'e1', name: 'Cube2' });
    expect(result.valid).toBe(true);
  });

  it('validates update_light correctly', () => {
    const result = validateBuiltInCommand('update_light', {
      entityId: 'e1',
      intensity: 1.0,
      shadows: true,
    });
    expect(result.valid).toBe(true);
  });

  it('validates set_audio correctly', () => {
    const result = validateBuiltInCommand('set_audio', {
      entityId: 'e1',
      volume: 0.8,
      loop: true,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects set_audio when volume out of range', () => {
    const result = validateBuiltInCommand('set_audio', {
      entityId: 'e1',
      volume: 1.5,
    });
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// All built-in schemas are present
// ---------------------------------------------------------------------------

describe('BUILT_IN_SCHEMAS', () => {
  it('includes all expected command schemas', () => {
    const expectedCommands = [
      'spawn_entity', 'set_material', 'update_transform', 'set_physics',
      'set_script', 'delete_entity', 'rename_entity', 'set_audio',
      'update_light',
    ];
    for (const cmd of expectedCommands) {
      expect(BUILT_IN_SCHEMAS[cmd], `Missing schema for ${cmd}`).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// validateOrWarn — warning behaviour
// ---------------------------------------------------------------------------

describe('validateOrWarn', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true and does not warn for valid input', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const valid = validateOrWarn('spawn_entity', { entityType: 'cube' });
    expect(valid).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns false and logs a warning for invalid input', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const valid = validateOrWarn('spawn_entity', { entityType: 'not_a_type' });
    expect(valid).toBe(false);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('[SchemaValidator]');
  });

  it('accepts an ad-hoc schema', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const customSchema: SchemaDefinition = {
      name: 'custom_op',
      fields: { id: { type: 'string', required: true } },
    };
    const valid = validateOrWarn('custom_op', { id: 'abc' }, customSchema);
    expect(valid).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns true and does not warn for unknown command without schema', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const valid = validateOrWarn('completely_unknown', { whatever: true });
    expect(valid).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
