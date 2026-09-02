import { describe, it, expect } from 'vitest';
import manifest from '../manifest/commands.json';

const EXPECTED_CATEGORIES = [
  'animation', 'asset', 'audio', 'camera', 'compound', 'cutscene', 'dialogue',
  'docs', 'economy', 'editor', 'environment', 'export', 'game_cameras',
  'game_components', 'generation', 'history', 'lighting', 'localization',
  'materials', 'mesh', 'modeling', 'particles', 'performance', 'physics2d',
  'prefab', 'publishing', 'query', 'rendering', 'runtime', 'scene', 'scripting',
  'security', 'shaders', 'skeleton2d', 'sprite', 'sprite_animation', 'templates',
  'terrain', 'tilemap', 'ui', 'world_building',
];

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

  it('categories use valid snake_case format', () => {
    const categoryPattern = /^[a-z][a-z0-9_]*$/;
    for (const cmd of manifest.commands) {
      expect(
        categoryPattern.test(cmd.category),
        `${cmd.name}: category '${cmd.category}' must match [a-z][a-z0-9_]* pattern`,
      ).toBe(true);
    }
  });

  it('category set has not changed unexpectedly (snapshot guard)', () => {
    const actualCategories = [...new Set(
      manifest.commands.map((c: { category: string }) => c.category),
    )].sort();

    expect(
      actualCategories,
      'Manifest category set changed — update EXPECTED_CATEGORIES if intentional',
    ).toEqual(EXPECTED_CATEGORIES);
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
    const scopePattern = /^[a-z_]+:(read|write|generate|manage)$/;
    for (const cmd of manifest.commands) {
      expect(
        scopePattern.test(cmd.requiredScope),
        `${cmd.name}: invalid scope format '${cmd.requiredScope}'`
      ).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // PF-8860 — the `destructive` flag that drives the chat agent's approval gate
  // -------------------------------------------------------------------------
  describe('destructive flag', () => {
    const flagged = manifest.commands.filter(
      (c) => (c as { destructive?: unknown }).destructive === true,
    );

    it('is present on a non-empty, plausible subset of commands', () => {
      // A gate derived from zero flagged commands gates nothing and would pass
      // every other assertion in this block vacuously.
      expect(flagged.length).toBeGreaterThan(10);
      expect(flagged.length).toBeLessThan(manifest.commands.length / 4);
    });

    it('is only ever the literal `true` when present', () => {
      // `destructive: false` must not appear: absence is the negative case, so
      // a stray `false` would be a second way to say the same thing.
      for (const cmd of manifest.commands) {
        const value = (cmd as { destructive?: unknown }).destructive;
        expect([undefined, true], `${cmd.name}`).toContain(value);
      }
    });

    it('covers the commands that destroy user content', () => {
      const names = new Set(flagged.map((c) => c.name));
      for (const name of [
        'delete_entities', 'despawn_entity', 'delete_scene', 'delete_prefab',
        'new_scene', 'clear_world', 'load_scene', 'switch_scene', 'publish_game',
      ]) {
        expect(names.has(name), `${name} must be flagged destructive`).toBe(true);
      }
    });

    it('leaves ordinary editing commands unflagged', () => {
      const names = new Set(flagged.map((c) => c.name));
      for (const name of ['spawn_entity', 'update_transform', 'set_visibility', 'update_material']) {
        expect(names.has(name), `${name} must NOT be flagged destructive`).toBe(false);
      }
    });
  });

  it.each(manifest.commands)('$name has valid visibility field', (cmd) => {
    expect(
      ['public', 'internal'],
      `Command "${cmd.name}" has visibility "${(cmd as { name: string; visibility?: string }).visibility}" — must be "public" or "internal"`,
    ).toContain((cmd as { name: string; visibility?: string }).visibility);
  });
});
