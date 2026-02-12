import { describe, it, expect } from 'vitest';
import manifest from '../manifest/commands.json';

describe('command manifest', () => {
  it('has a version field', () => {
    expect(manifest.version).toBe('1.0');
  });

  it('has at least 20 commands', () => {
    expect(manifest.commands.length).toBeGreaterThanOrEqual(20);
  });

  it('every command has required fields', () => {
    for (const cmd of manifest.commands) {
      expect(cmd.name, `command missing name`).toBeTruthy();
      expect(cmd.description, `${cmd.name} missing description`).toBeTruthy();
      expect(cmd.category, `${cmd.name} missing category`).toBeTruthy();
      expect(cmd.parameters, `${cmd.name} missing parameters`).toBeDefined();
      expect(typeof cmd.tokenCost, `${cmd.name} tokenCost not number`).toBe('number');
      expect(cmd.requiredScope, `${cmd.name} missing requiredScope`).toBeTruthy();
    }
  });

  it('every command has unique name', () => {
    const names = manifest.commands.map((c: { name: string }) => c.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('parameters are valid JSON Schema objects', () => {
    for (const cmd of manifest.commands) {
      const params = cmd.parameters as { type?: string; properties?: Record<string, unknown> };
      expect(params.type, `${cmd.name}: parameters.type should be 'object'`).toBe('object');
      expect(params.properties, `${cmd.name}: parameters.properties missing`).toBeDefined();
    }
  });

  it('categories are from expected set', () => {
    const validCategories = ['scene', 'materials', 'lighting', 'environment', 'editor', 'camera', 'history', 'query', 'runtime', 'asset', 'scripting', 'audio', 'particles', 'export', 'rendering'];
    for (const cmd of manifest.commands) {
      expect(validCategories, `${cmd.name}: unexpected category '${cmd.category}'`).toContain(cmd.category);
    }
  });

  it('scene edit commands have zero token cost', () => {
    const sceneEditCmds = manifest.commands.filter(
      (c: { category: string; name: string }) => c.category === 'scene' || c.category === 'editor' || c.category === 'camera' || c.category === 'history'
    );
    for (const cmd of sceneEditCmds) {
      expect(cmd.tokenCost, `${cmd.name} should be free`).toBe(0);
    }
  });

  it('expected commands exist', () => {
    const names = new Set(manifest.commands.map((c: { name: string }) => c.name));
    const expected = [
      'spawn_entity', 'despawn_entity', 'update_transform',
      'update_material', 'undo', 'redo',
      'get_scene_graph', 'get_selection',
    ];
    for (const name of expected) {
      expect(names.has(name), `missing command: ${name}`).toBe(true);
    }
  });

  it('required scopes use valid format', () => {
    const scopePattern = /^[a-z]+:(read|write)$/;
    for (const cmd of manifest.commands) {
      expect(
        scopePattern.test(cmd.requiredScope),
        `${cmd.name}: invalid scope format '${cmd.requiredScope}'`
      ).toBe(true);
    }
  });
});
