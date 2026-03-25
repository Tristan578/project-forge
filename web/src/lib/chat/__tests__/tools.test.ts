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
      expect(tool.name).not.toBeUndefined();
      expect(typeof tool.name).toBe('string');
      expect(tool.description).not.toBeUndefined();
      expect(typeof tool.description).toBe('string');
      expect(tool.input_schema).not.toBeUndefined();
      expect(tool.input_schema.type).toBe('object');
    }
  });

  it('should include spawn_entity tool', () => {
    const tools = getChatTools();
    const spawn = tools.find((t) => t.name === 'spawn_entity');
    expect(spawn).not.toBeUndefined();
    expect(spawn!.input_schema.properties).not.toBeUndefined();
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
    expect(cmd).not.toBeUndefined();
    expect(cmd!.name).toBe('spawn_entity');
    expect(cmd!.description).not.toBeUndefined();
    expect(cmd!.category).not.toBeUndefined();
    expect(cmd!.parameters).not.toBeUndefined();
    expect(typeof cmd!.tokenCost).toBe('number');
  });

  it('should return undefined for unknown command', () => {
    expect(getCommandDef('nonexistent_xyz')).toBeUndefined();
  });

  it('should return undefined for empty name', () => {
    expect(getCommandDef('')).toBeUndefined();
  });
});
