// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SPAWNABLE_ENTITY_TYPES } from '../sceneGraphSlice';

/**
 * Parity guard for #8748.
 *
 * `spawnEntity` only dispatches `spawn_entity` (and returns a usable id) for the
 * entity types the engine's `apply_spawn_requests` actually spawns. That JS
 * allow-list, `SPAWNABLE_ENTITY_TYPES`, is hand-maintained in `sceneGraphSlice.ts`
 * and a comment claims it is "kept in sync" with the Rust match arms — but nothing
 * enforced that. A future engineer adding (or removing) a `spawn_*_with_id` arm in
 * Rust without touching the TS set would silently desync the two: either a newly
 * spawnable type returns `undefined` (spawns the caller can't reference) or a
 * removed type returns a phantom id (follow-up commands target a non-existent
 * entity). This test mirrors the Rust arms and fails on any diff, turning a silent
 * desync into a red build.
 */
describe('SPAWNABLE_ENTITY_TYPES ↔ engine apply_spawn_requests parity', () => {
  // web/ is the vitest cwd; the engine source lives at the repo/worktree root.
  const entityFactoryPath = resolve(process.cwd(), '..', 'engine', 'src', 'core', 'entity_factory.rs');

  function pascalToSnake(variant: string): string {
    return variant
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2') // ABCFoo -> ABC_Foo (acronym boundary)
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2') // fooBar -> foo_Bar
      .toLowerCase();
  }

  it('the engine source file exists where this test expects it', () => {
    expect(
      existsSync(entityFactoryPath),
      `Expected engine source at ${entityFactoryPath}. If the engine moved, update this parity test ` +
        `so it keeps guarding the SPAWNABLE_ENTITY_TYPES ↔ apply_spawn_requests contract (#8748).`,
    ).toBe(true);
  });

  it('the JS spawnable set exactly equals the engine spawn arms (no silent desync)', () => {
    const src = readFileSync(entityFactoryPath, 'utf8');

    // Every spawnable arm has the shape `EntityType::Variant => spawn_<x>_with_id(`.
    // The `continue` arms (Sprite, GltfModel|GltfMesh, CsgResult, Terrain,
    // ProceduralMesh) have no `spawn_*_with_id` call and are correctly excluded.
    const matches = [...src.matchAll(/EntityType::(\w+)\s*=>\s*spawn_\w+_with_id\b/g)];
    const engineSpawnable = new Set(matches.map((m) => pascalToSnake(m[1])));

    // Guard against a regex that silently matches nothing (which would otherwise
    // make a shrunk JS set falsely "pass" against an empty engine set).
    expect(engineSpawnable.size).toBeGreaterThan(0);

    const jsSpawnable = new Set(SPAWNABLE_ENTITY_TYPES);

    // Deterministic, diff-friendly comparison.
    const sorted = (s: Set<string>) => [...s].sort();
    expect(
      sorted(jsSpawnable),
      'SPAWNABLE_ENTITY_TYPES in web/src/stores/slices/sceneGraphSlice.ts is out of sync ' +
        'with the spawn_*_with_id arms in engine/src/core/entity_factory.rs (#8748). ' +
        'Add/remove the listed type(s) in SPAWNABLE_ENTITY_TYPES to match the engine.',
    ).toEqual(sorted(engineSpawnable));
  });
});
