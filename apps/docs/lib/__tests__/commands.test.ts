/**
 * @vitest-environment node
 *
 * Logic tests for the manifest summariser and the category reader, driven by
 * fixture manifests through the pure `summarizeManifest` / `commandsInCategory`
 * entry points.
 *
 * This suite used to stub `fs.readFileSync` and import the module fresh per
 * case. That shape is what let #9718 ship: the loader's real defect was WHERE
 * the manifest came from, and a mocked `fs` is blind to exactly that (lesson
 * 14). The loader now imports the manifest statically, so there is no `fs`
 * to mock. This file is hermetic: every input is a fixture built here, and
 * nothing in it depends on the contents of the shipped `data/commands.json`.
 * The real file — and the page-facing `readCommandsManifest` /
 * `readCommandsByCategory` wrappers, which can only be exercised over it —
 * are `commandsManifestArtifact.test.ts`'s job.
 */
import { describe, it, expect } from 'vitest';

import {
  commandsInCategory,
  publicCommandsOf,
  summarizeManifest,
  toParameterList,
  type CommandEntry,
  type CommandsManifest,
} from '../commands';

function manifestOf(commands: CommandEntry[]): CommandsManifest {
  return { commands };
}

describe('summarizeManifest', () => {
  describe('public filtering', () => {
    it('counts only public commands', () => {
      const result = summarizeManifest(
        manifestOf([
          { name: 'spawn_entity', category: 'transform', visibility: 'public' },
          { name: '_internal_reset', category: 'transform', visibility: 'internal' },
          { name: 'delete_entity', category: 'transform', visibility: 'public' },
        ]),
      );

      expect(result.publicCount).toBe(2);
    });

    it('returns publicCount of 0 when all commands are internal', () => {
      const result = summarizeManifest(
        manifestOf([{ name: '_debug_dump', category: 'internal', visibility: 'internal' }]),
      );

      expect(result.publicCount).toBe(0);
      expect(result.categories).toEqual([]);
      expect(result.scopes).toEqual([]);
    });

    it('treats a command with no visibility as not public', () => {
      expect(publicCommandsOf(manifestOf([{ name: 'spawn_entity', category: 'scene' }]))).toEqual(
        [],
      );
    });
  });

  describe('category extraction', () => {
    it('extracts unique categories from public commands', () => {
      const result = summarizeManifest(
        manifestOf([
          { name: 'spawn_entity', category: 'transform', visibility: 'public' },
          { name: 'move_entity', category: 'transform', visibility: 'public' },
          { name: 'set_material', category: 'material', visibility: 'public' },
          { name: '_skip', category: 'internal', visibility: 'internal' },
        ]),
      );

      expect(result.categories).toHaveLength(2);
      expect(result.categories).toContain('transform');
      expect(result.categories).toContain('material');
    });

    it('excludes categories from internal commands', () => {
      const result = summarizeManifest(
        manifestOf([
          { name: 'spawn_entity', category: 'transform', visibility: 'public' },
          { name: '_debug', category: 'debug', visibility: 'internal' },
        ]),
      );

      expect(result.categories).not.toContain('debug');
    });

    it('skips a public command with an empty category', () => {
      const result = summarizeManifest(
        manifestOf([{ name: 'spawn_entity', category: '', visibility: 'public' }]),
      );

      expect(result.publicCount).toBe(1);
      expect(result.categories).toEqual([]);
    });
  });

  describe('scope prefix regex', () => {
    it('extracts namespace prefixes from command names via /^([a-z_]+)_/ regex', () => {
      const result = summarizeManifest(
        manifestOf([
          { name: 'create_entity', category: 'transform', visibility: 'public' },
          { name: 'query_scene', category: 'scene', visibility: 'public' },
          { name: 'set_transform', category: 'transform', visibility: 'public' },
        ]),
      );

      expect(result.scopes).toContain('create');
      expect(result.scopes).toContain('query');
      expect(result.scopes).toContain('set');
    });

    it('de-duplicates scope prefixes across multiple commands', () => {
      const result = summarizeManifest(
        manifestOf([
          { name: 'create_entity', category: 'transform', visibility: 'public' },
          { name: 'create_material', category: 'material', visibility: 'public' },
          { name: 'create_light', category: 'lighting', visibility: 'public' },
        ]),
      );

      const createCount = result.scopes.filter((s) => s === 'create').length;
      expect(createCount).toBe(1);
    });

    it('does not extract a scope for commands with no underscore', () => {
      const result = summarizeManifest(
        manifestOf([
          // 'spawn' has no underscore — regex /^([a-z_]+)_/ does not match
          { name: 'spawn', category: 'transform', visibility: 'public' },
          { name: 'create_entity', category: 'transform', visibility: 'public' },
        ]),
      );

      // Only 'create' from 'create_entity'; 'spawn' contributes no scope
      expect(result.scopes).toEqual(['create']);
    });
  });

  describe('empty manifest', () => {
    it('returns zeros and empty arrays for a manifest with no commands', () => {
      const result = summarizeManifest(manifestOf([]));

      expect(result.publicCount).toBe(0);
      expect(result.categories).toEqual([]);
      expect(result.scopes).toEqual([]);
    });

    it('handles a missing commands key via nullish coalescing', () => {
      // Manifest with no "commands" key — tests the `?? []` guard in the source
      const result = summarizeManifest({});

      expect(result.publicCount).toBe(0);
    });
  });
});

/**
 * `commandsInCategory` and `toParameterList` back `/mcp/[category]`, the
 * route added for #9046 — every category tile on `/mcp` linked to
 * `/mcp/${category}` while no such route existed.
 */
describe('commandsInCategory', () => {
  it('returns only the public commands in the requested category', () => {
    const source = manifestOf([
      { name: 'spawn_entity', category: 'scene', visibility: 'public' },
      { name: 'set_material', category: 'materials', visibility: 'public' },
      { name: '_scene_debug', category: 'scene', visibility: 'internal' },
    ]);

    expect(commandsInCategory(source, 'scene').map((c) => c.name)).toEqual(['spawn_entity']);
  });

  it('sorts commands by name so the page order is stable', () => {
    const source = manifestOf([
      { name: 'zoom_camera', category: 'camera', visibility: 'public' },
      { name: 'aim_camera', category: 'camera', visibility: 'public' },
      { name: 'move_camera', category: 'camera', visibility: 'public' },
    ]);

    expect(commandsInCategory(source, 'camera').map((c) => c.name)).toEqual([
      'aim_camera',
      'move_camera',
      'zoom_camera',
    ]);
  });

  // The page turns this into notFound(). If it ever returned a non-empty array
  // for an unknown slug, /mcp/anything would render an empty shell with a 200.
  it('returns an empty array for an unknown category', () => {
    const source = manifestOf([{ name: 'spawn_entity', category: 'scene', visibility: 'public' }]);

    expect(commandsInCategory(source, 'no-such-category')).toEqual([]);
  });

  it('every category summarizeManifest advertises has at least one command', () => {
    const source = manifestOf([
      { name: 'spawn_entity', category: 'scene', visibility: 'public' },
      { name: 'set_material', category: 'materials', visibility: 'public' },
    ]);
    const { categories } = summarizeManifest(source);

    expect(categories.length).toBeGreaterThan(0);
    for (const category of categories) {
      expect(commandsInCategory(source, category).length).toBeGreaterThan(0);
    }
  });
});

describe('toParameterList', () => {
  it('flattens the JSON Schema properties map into display rows', () => {
    expect(
      toParameterList({
        name: 'spawn_entity',
        category: 'scene',
        parameters: {
          type: 'object',
          properties: {
            entityType: { type: 'string', description: 'Type of entity' },
            name: { type: 'string' },
          },
          required: ['entityType'],
        },
      }),
    ).toEqual([
      { name: 'entityType', type: 'string', required: true, description: 'Type of entity' },
      { name: 'name', type: 'string', required: false, description: undefined },
    ]);
  });

  it('puts required parameters first, then alphabetises within each group', () => {
    const rows = toParameterList({
      name: 'x',
      category: 'scene',
      parameters: {
        properties: {
          zeta: { type: 'string' },
          alpha: { type: 'string' },
          omega: { type: 'string' },
          beta: { type: 'string' },
        },
        required: ['omega', 'beta'],
      },
    });

    expect(rows.map((r) => r.name)).toEqual(['beta', 'omega', 'alpha', 'zeta']);
  });

  it('falls back to "unknown" for a property with no declared type', () => {
    expect(
      toParameterList({
        name: 'x',
        category: 'scene',
        parameters: { properties: { mystery: {} } },
      }),
    ).toEqual([{ name: 'mystery', type: 'unknown', required: false, description: undefined }]);
  });

  it.each([
    ['no parameters key', { name: 'x', category: 'scene' }],
    ['parameters with no properties', { name: 'x', category: 'scene', parameters: {} }],
  ])('returns an empty list for a command with %s', (_label, cmd) => {
    expect(toParameterList(cmd)).toEqual([]);
  });
});
