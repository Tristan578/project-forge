/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';

// We intercept fs.readFileSync before importing the module under test.
// The module resolves MANIFEST_PATH at load time, so we mock at the fs layer:
// any read of a path ending in 'commands.json' returns the content we prepared.

function makeManifestJson(commands: object[]): string {
  return JSON.stringify({ commands });
}

describe('readCommandsManifest', () => {
  let fsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    // Default spy — overridden per test via mockReturnValue / mockImplementation
    fsSpy = vi.spyOn(fs, 'readFileSync');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubManifest(commands: object[]): void {
    const content = makeManifestJson(commands);
    fsSpy.mockImplementation((filePath, _enc) => {
      if (String(filePath).endsWith('commands.json')) {
        return content;
      }
      throw new Error(`ENOENT: ${String(filePath)}`);
    });
  }

  describe('public filtering', () => {
    it('counts only public commands', async () => {
      stubManifest([
        { name: 'spawn_entity', category: 'transform', visibility: 'public' },
        { name: '_internal_reset', category: 'transform', visibility: 'internal' },
        { name: 'delete_entity', category: 'transform', visibility: 'public' },
      ]);

      const { readCommandsManifest } = await import('../commands.js');
      const result = await readCommandsManifest();

      expect(result.publicCount).toBe(2);
    });

    it('returns publicCount of 0 when all commands are internal', async () => {
      stubManifest([{ name: '_debug_dump', category: 'internal', visibility: 'internal' }]);

      const { readCommandsManifest } = await import('../commands.js');
      const result = await readCommandsManifest();

      expect(result.publicCount).toBe(0);
      expect(result.categories).toEqual([]);
      expect(result.scopes).toEqual([]);
    });
  });

  describe('category extraction', () => {
    it('extracts unique categories from public commands', async () => {
      stubManifest([
        { name: 'spawn_entity', category: 'transform', visibility: 'public' },
        { name: 'move_entity', category: 'transform', visibility: 'public' },
        { name: 'set_material', category: 'material', visibility: 'public' },
        { name: '_skip', category: 'internal', visibility: 'internal' },
      ]);

      const { readCommandsManifest } = await import('../commands.js');
      const result = await readCommandsManifest();

      expect(result.categories).toHaveLength(2);
      expect(result.categories).toContain('transform');
      expect(result.categories).toContain('material');
    });

    it('excludes categories from internal commands', async () => {
      stubManifest([
        { name: 'spawn_entity', category: 'transform', visibility: 'public' },
        { name: '_debug', category: 'debug', visibility: 'internal' },
      ]);

      const { readCommandsManifest } = await import('../commands.js');
      const result = await readCommandsManifest();

      expect(result.categories).not.toContain('debug');
    });
  });

  describe('scope prefix regex', () => {
    it('extracts namespace prefixes from command names via /^([a-z_]+)_/ regex', async () => {
      stubManifest([
        { name: 'create_entity', category: 'transform', visibility: 'public' },
        { name: 'query_scene', category: 'scene', visibility: 'public' },
        { name: 'set_transform', category: 'transform', visibility: 'public' },
      ]);

      const { readCommandsManifest } = await import('../commands.js');
      const result = await readCommandsManifest();

      expect(result.scopes).toContain('create');
      expect(result.scopes).toContain('query');
      expect(result.scopes).toContain('set');
    });

    it('de-duplicates scope prefixes across multiple commands', async () => {
      stubManifest([
        { name: 'create_entity', category: 'transform', visibility: 'public' },
        { name: 'create_material', category: 'material', visibility: 'public' },
        { name: 'create_light', category: 'lighting', visibility: 'public' },
      ]);

      const { readCommandsManifest } = await import('../commands.js');
      const result = await readCommandsManifest();

      const createCount = result.scopes.filter((s) => s === 'create').length;
      expect(createCount).toBe(1);
    });

    it('does not extract a scope for commands with no underscore', async () => {
      stubManifest([
        // 'spawn' has no underscore — regex /^([a-z_]+)_/ does not match
        { name: 'spawn', category: 'transform', visibility: 'public' },
        { name: 'create_entity', category: 'transform', visibility: 'public' },
      ]);

      const { readCommandsManifest } = await import('../commands.js');
      const result = await readCommandsManifest();

      // Only 'create' from 'create_entity'; 'spawn' contributes no scope
      expect(result.scopes).toEqual(['create']);
    });
  });

  describe('empty manifest', () => {
    it('returns zeros and empty arrays for a manifest with no commands', async () => {
      stubManifest([]);

      const { readCommandsManifest } = await import('../commands.js');
      const result = await readCommandsManifest();

      expect(result.publicCount).toBe(0);
      expect(result.categories).toEqual([]);
      expect(result.scopes).toEqual([]);
    });

    it('handles missing commands key gracefully via nullish coalescing', async () => {
      // Manifest with no "commands" key — tests the `?? []` guard in the source
      fsSpy.mockImplementation((filePath, _enc) => {
        if (String(filePath).endsWith('commands.json')) {
          return JSON.stringify({});
        }
        throw new Error(`ENOENT: ${String(filePath)}`);
      });

      const { readCommandsManifest } = await import('../commands.js');
      const result = await readCommandsManifest();

      expect(result.publicCount).toBe(0);
    });
  });

  describe('error recovery', () => {
    it('returns safe empty result when the manifest file does not exist', async () => {
      fsSpy.mockImplementation((_filePath, _enc) => {
        throw new Error('ENOENT: no such file');
      });

      const { readCommandsManifest } = await import('../commands.js');
      const result = await readCommandsManifest();

      expect(result).toEqual({ categories: [], scopes: [], publicCount: 0 });
    });

    it('returns safe empty result when the manifest contains invalid JSON', async () => {
      fsSpy.mockImplementation((filePath, _enc) => {
        if (String(filePath).endsWith('commands.json')) {
          return '{ not valid json }';
        }
        throw new Error(`ENOENT: ${String(filePath)}`);
      });

      const { readCommandsManifest } = await import('../commands.js');
      const result = await readCommandsManifest();

      expect(result).toEqual({ categories: [], scopes: [], publicCount: 0 });
    });
  });
});
