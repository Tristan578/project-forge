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
  // Doc-truth (#9293): the README and the setup guide quoted 350, 351 and 322
  // commands for a manifest of 351. Every "N commands" claim in either doc
  // must equal the manifest, and the sweep must find at least one claim or it
  // is vacuous.
  it('every command count quoted in the docs equals the manifest', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const here = resolve(new URL('.', import.meta.url).pathname);
    const docs = [resolve(here, '../README.md'), resolve(here, '../../docs/guides/mcp-server-setup.md')];
    let claims = 0;
    for (const file of docs) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\b(\d{2,4}) (?:SpawnForge editor )?commands\b/g)) {
        claims += 1;
        expect(Number(m[1]), `${file} says "${m[0]}"`).toBe(manifest.commands.length);
      }
    }
    expect(claims).toBeGreaterThan(0);
  });

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

  it.each(manifest.commands)('$name has valid visibility field', (cmd) => {
    expect(
      ['public', 'internal'],
      `Command "${cmd.name}" has visibility "${(cmd as { name: string; visibility?: string }).visibility}" — must be "public" or "internal"`,
    ).toContain((cmd as { name: string; visibility?: string }).visibility);
  });
});
