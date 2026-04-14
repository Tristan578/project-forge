import { describe, it, expect } from 'vitest';
import { jsonSchemaToZod, buildZodSchema, deriveAnnotations } from './generated.js';
import { z } from 'zod';

describe('jsonSchemaToZod', () => {
  it('converts string type', () => {
    const schema = jsonSchemaToZod({ type: 'string' });
    expect(schema.parse('hello')).toBe('hello');
    expect(() => schema.parse(123)).toThrow();
  });

  it('converts string enum', () => {
    const schema = jsonSchemaToZod({ type: 'string', enum: ['a', 'b', 'c'] });
    expect(schema.parse('a')).toBe('a');
    expect(() => schema.parse('d')).toThrow();
  });

  it('converts number type', () => {
    const schema = jsonSchemaToZod({ type: 'number' });
    expect(schema.parse(3.14)).toBe(3.14);
    expect(() => schema.parse('abc')).toThrow();
  });

  it('converts integer type', () => {
    const schema = jsonSchemaToZod({ type: 'integer' });
    expect(schema.parse(42)).toBe(42);
    expect(() => schema.parse(3.14)).toThrow();
  });

  it('converts boolean type', () => {
    const schema = jsonSchemaToZod({ type: 'boolean' });
    expect(schema.parse(true)).toBe(true);
    expect(() => schema.parse('yes')).toThrow();
  });

  it('converts array type with items', () => {
    const schema = jsonSchemaToZod({ type: 'array', items: { type: 'number' } });
    expect(schema.parse([1, 2, 3])).toEqual([1, 2, 3]);
    expect(() => schema.parse(['a'])).toThrow();
  });

  it('converts array type without items', () => {
    const schema = jsonSchemaToZod({ type: 'array' });
    expect(schema.parse([1, 'a', true])).toEqual([1, 'a', true]);
  });

  it('converts object type', () => {
    const schema = jsonSchemaToZod({ type: 'object' });
    expect(schema.parse({ foo: 'bar' })).toEqual({ foo: 'bar' });
  });

  it('returns unknown for unrecognized types', () => {
    const schema = jsonSchemaToZod({ type: 'custom' });
    expect(schema.parse('anything')).toBe('anything');
  });
});

describe('buildZodSchema', () => {
  it('builds shape with required and optional fields', () => {
    const shape = buildZodSchema({
      properties: {
        name: { type: 'string', description: 'Entity name' },
        x: { type: 'number' },
        y: { type: 'number' },
        visible: { type: 'boolean' },
      },
      required: ['name'],
    });

    expect(Object.keys(shape)).toEqual(['name', 'x', 'y', 'visible']);

    // Required field
    const nameSchema = z.object({ name: shape.name });
    expect(nameSchema.parse({ name: 'test' })).toEqual({ name: 'test' });
    expect(() => nameSchema.parse({})).toThrow();

    // Optional fields
    const optSchema = z.object({ x: shape.x });
    expect(optSchema.parse({})).toEqual({});
    expect(optSchema.parse({ x: 5 })).toEqual({ x: 5 });
  });

  it('handles empty properties', () => {
    const shape = buildZodSchema({ properties: {}, required: [] });
    expect(Object.keys(shape)).toEqual([]);
  });

  it('handles missing properties and required', () => {
    const shape = buildZodSchema({});
    expect(Object.keys(shape)).toEqual([]);
  });

  it('preserves descriptions', () => {
    const shape = buildZodSchema({
      properties: {
        name: { type: 'string', description: 'The entity name' },
      },
      required: ['name'],
    });
    expect(shape.name.description).toBe('The entity name');
  });
});

describe('deriveAnnotations', () => {
  it('marks read scopes as readOnly', () => {
    const ann = deriveAnnotations('scene:read', 'get_scene_graph');
    expect(ann.readOnlyHint).toBe(true);
    expect(ann.destructiveHint).toBe(false);
  });

  it('marks write scopes as not readOnly', () => {
    const ann = deriveAnnotations('scene:write', 'update_transform');
    expect(ann.readOnlyHint).toBe(false);
    expect(ann.destructiveHint).toBe(false);
  });

  it('marks despawn commands as destructive', () => {
    const ann = deriveAnnotations('scene:write', 'despawn_entity');
    expect(ann.destructiveHint).toBe(true);
  });

  it('marks delete commands as destructive', () => {
    const ann = deriveAnnotations('scene:write', 'delete_audio_bus');
    expect(ann.destructiveHint).toBe(true);
  });

  it('marks remove commands as destructive', () => {
    const ann = deriveAnnotations('scene:write', 'remove_script');
    expect(ann.destructiveHint).toBe(true);
  });

  it('marks clear_scene as destructive', () => {
    const ann = deriveAnnotations('scene:write', 'clear_scene');
    expect(ann.destructiveHint).toBe(true);
  });

  it('marks undo/redo as destructive', () => {
    expect(deriveAnnotations('scene:write', 'undo').destructiveHint).toBe(true);
    expect(deriveAnnotations('scene:write', 'redo').destructiveHint).toBe(true);
  });

  it('sets openWorldHint to false', () => {
    const ann = deriveAnnotations('scene:write', 'spawn_entity');
    expect(ann.openWorldHint).toBe(false);
  });
});
