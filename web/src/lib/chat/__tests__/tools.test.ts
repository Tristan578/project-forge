import { describe, it, expect } from 'vitest';
import { getChatTools, getCommandNames, getCommandDef } from '../tools';

describe('getChatTools', () => {
  it('should return an array of tools', () => {
    const tools = getChatTools();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it('should have valid tool structure', () => {
    const tools = getChatTools();
    for (const tool of tools) {
      expect(tool.name).toBeDefined();
      expect(typeof tool.name).toBe('string');
      expect(tool.description).toBeDefined();
      expect(typeof tool.description).toBe('string');
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe('object');
    }
  });

  it('should include spawn_entity tool', () => {
    const tools = getChatTools();
    const spawn = tools.find((t) => t.name === 'spawn_entity');
    expect(spawn).toBeDefined();
    expect(spawn!.input_schema.properties).toBeDefined();
  });

  it('should not advertise spawn_entity.id to the model', () => {
    // The manifest documents `id` because a direct-to-engine MCP client has a real
    // use for it. The chat path does not: the store mints the id itself and returns
    // it synchronously, so a model-supplied id buys nothing — and the engine's
    // `is_valid_override_id` checks only length and control characters, so an id
    // colliding with an existing entity would silently make every id-matching loop
    // in the engine address the wrong entity.
    const spawn = getChatTools().find((t) => t.name === 'spawn_entity');
    expect(Object.keys(spawn!.input_schema.properties!)).not.toContain('id');
    expect(spawn!.input_schema.required).not.toContain('id');
  });

  it('should still advertise every other documented spawn_entity property', () => {
    const spawn = getChatTools().find((t) => t.name === 'spawn_entity');
    const documented = Object.keys(getCommandDef('spawn_entity')!.parameters.properties!);
    expect(Object.keys(spawn!.input_schema.properties!).sort()).toEqual(
      documented.filter((key) => key !== 'id').sort(),
    );
  });

  it('should not mutate the shared manifest when excluding a property', () => {
    // The manifest object is module-scoped and also read by getCommandDef; a
    // destructive delete here would strip `id` from every other consumer.
    getChatTools();
    expect(getCommandDef('spawn_entity')!.parameters.properties).toHaveProperty('id');
  });
});

describe('getCommandNames', () => {
  it('should return all command names', () => {
    const names = getCommandNames();
    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain('spawn_entity');
  });

  it('should return strings', () => {
    const names = getCommandNames();
    for (const name of names) {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
  });
});

describe('getCommandDef', () => {
  it('should find a known command', () => {
    const cmd = getCommandDef('spawn_entity');
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe('spawn_entity');
    expect(cmd!.description).toBeDefined();
    expect(cmd!.category).toBeDefined();
    expect(cmd!.parameters).toBeDefined();
    expect(typeof cmd!.tokenCost).toBe('number');
  });

  it('should return undefined for unknown command', () => {
    expect(getCommandDef('nonexistent_xyz')).toBeUndefined();
  });

  it('should return undefined for empty name', () => {
    expect(getCommandDef('')).toBeUndefined();
  });
});

describe('spawn_entity position parameter (PF-1112)', () => {
  it('is advertised to the model, not just documented for MCP clients', () => {
    // The handler now reads `position`; the model can only send it if the tool
    // schema carries it, so the two have to be checked together.
    const spawn = getChatTools().find((t) => t.name === 'spawn_entity');
    expect(Object.keys(spawn!.input_schema.properties!)).toContain('position');
  });
});
