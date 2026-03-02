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
