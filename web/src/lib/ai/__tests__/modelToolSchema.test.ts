import { describe, it, expect } from 'vitest';
import { EXCLUDED_TOOL_PROPERTIES, modelToolSchema } from '../modelToolSchema';

describe('modelToolSchema', () => {
  it('drops an excluded property and its required entry', () => {
    const schema = modelToolSchema('spawn_entity', {
      type: 'object',
      properties: { entityType: { type: 'string' }, id: { type: 'string' } },
      required: ['entityType', 'id'],
    });

    expect(schema.properties).toEqual({ entityType: { type: 'string' } });
    expect(schema.required).toEqual(['entityType']);
  });

  it('leaves a command with no exclusions untouched', () => {
    const properties = { entityId: { type: 'string' } };
    const schema = modelToolSchema('despawn_entity', {
      type: 'object',
      properties,
      required: ['entityId'],
    });

    expect(schema.properties).toEqual(properties);
    expect(schema.required).toEqual(['entityId']);
  });

  // The manifest is a static JSON import shared by both tool surfaces and by the
  // MCP server, which DOES offer `id` legitimately. Filtering in place would strip
  // it from every consumer in the process.
  it('does not mutate the schema it was given', () => {
    const parameters = {
      type: 'object',
      properties: { entityType: { type: 'string' }, id: { type: 'string' } },
      required: ['entityType', 'id'],
    };

    modelToolSchema('spawn_entity', parameters);

    expect(Object.keys(parameters.properties)).toEqual(['entityType', 'id']);
    expect(parameters.required).toEqual(['entityType', 'id']);
  });

  // `getAgentTools` used to carry its own copy of this normalization. Both callers
  // now share it, so the array-style and absent forms have to survive here.
  it('normalizes a missing, array-style, or partial schema to an object schema', () => {
    expect(modelToolSchema('spawn_entity', undefined)).toEqual({
      type: 'object',
      properties: {},
      required: [],
    });
    expect(modelToolSchema('spawn_entity', [{ name: 'legacy' }])).toEqual({
      type: 'object',
      properties: {},
      required: [],
    });
    expect(modelToolSchema('despawn_entity', { type: 'object' })).toEqual({
      type: 'object',
      properties: {},
      required: [],
    });
  });

  it('exposes spawn_entity.id as the exclusion that motivates the seam', () => {
    expect(EXCLUDED_TOOL_PROPERTIES.spawn_entity).toContain('id');
  });
});
