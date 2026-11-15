import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PROTECTED_FIELDS,
  hashSnapshot,
  createAssetVersion,
  bumpAssetVersion,
  isCompatibleSource,
  buildReferenceCrosswalk,
  reimportPreview,
  applyReimport,
  detectVersionConflict,
  resolveVersionConflict,
  type PrefabInstance,
} from '../assetVersion';
import type { PrefabSnapshot } from '../prefabStore';

const baseSource: PrefabSnapshot = {
  entityType: 'cube',
  name: 'Crate',
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  material: {
    baseColor: [0.5, 0.3, 0.15, 1], metallic: 0, perceptualRoughness: 0.7, reflectance: 0.5,
    emissive: [0, 0, 0, 1], emissiveExposureWeight: 0, alphaMode: 'opaque', alphaCutoff: 0.5,
    doubleSided: false, unlit: false, uvOffset: [0, 0], uvScale: [1, 1], uvRotation: 0,
    parallaxDepthScale: 0.1, parallaxMappingMethod: 'occlusion', maxParallaxLayerCount: 16,
    parallaxReliefMaxSteps: 5, clearcoat: 0, clearcoatPerceptualRoughness: 0.5,
    specularTransmission: 0, diffuseTransmission: 0, ior: 1.5, thickness: 0,
    attenuationDistance: null, attenuationColor: [1, 1, 1],
  },
  script: { source: 'function onUpdate(dt) {}', enabled: true, template: 'noop' },
};

// A re-read of the source asset: material recolored, script rewritten.
const nextSource: PrefabSnapshot = {
  ...baseSource,
  material: { ...baseSource.material!, baseColor: [0.1, 0.8, 0.2, 1], perceptualRoughness: 0.2 },
  script: { source: 'function onUpdate(dt) { forge.rotate(entityId, 0, dt, 0); }', enabled: true, template: 'spin' },
};

function makeInstance(id: string, overrides: string[] = [], snap: PrefabSnapshot = baseSource): PrefabInstance {
  return { id, prefabId: 'prefab_crate', snapshot: structuredClone(snap), overrides };
}

describe('scene.FR-2.OP-01 asset versions and dependency crosswalks', () => {
  it('createAssetVersion starts at version 1 with a source hash and default protected fields', () => {
    const v = createAssetVersion(baseSource);
    expect(v.versionNumber).toBe(1);
    expect(v.sourceHash).toBe(hashSnapshot(baseSource));
    expect(v.sourceHash).not.toBe('');
    expect(v.protectedFields).toEqual([...DEFAULT_PROTECTED_FIELDS]);
    expect(v.createdAt).not.toBe('');
    expect(v.updatedAt).toBe(v.createdAt);
    expect(v.id).toContain('v1');
  });

  it('hashSnapshot is stable regardless of key insertion order and changes with content', () => {
    const reordered: PrefabSnapshot = {
      name: 'Crate',
      transform: { rotation: [0, 0, 0], scale: [1, 1, 1], position: [0, 0, 0] },
      entityType: 'cube',
      script: baseSource.script,
      material: baseSource.material,
    } as PrefabSnapshot;
    expect(hashSnapshot(reordered)).toBe(hashSnapshot(baseSource));
    expect(hashSnapshot(nextSource)).not.toBe(hashSnapshot(baseSource));
  });

  it('buildReferenceCrosswalk maps a prefab to the instance ids that reference it', () => {
    const instances = [
      makeInstance('i1'),
      makeInstance('i2'),
      { ...makeInstance('i3'), prefabId: 'prefab_other' },
    ];
    const crosswalk = buildReferenceCrosswalk('prefab_crate', instances);
    expect(crosswalk.prefabId).toBe('prefab_crate');
    expect(crosswalk.instanceIds).toEqual(['i1', 'i2']);
    expect(crosswalk.referenceCount).toBe(2);
  });
});

describe('scene.FR-2.OP-02 impact preview and version selection', () => {
  it('reimportPreview lists affected instances and the fields that would change, without mutating input', () => {
    const version = createAssetVersion(baseSource);
    const instances = [makeInstance('i1'), makeInstance('i2')];
    const frozen = structuredClone(instances);
    const preview = reimportPreview(baseSource, nextSource, version, instances);
    expect(preview.ok).toBe(true);
    expect(preview.fromVersion).toBe(1);
    expect(preview.toVersion).toBe(2);
    expect(preview.affectedInstanceIds).toEqual(['i1', 'i2']);
    // material changed and is not protected -> listed; script is protected by default -> preserved
    const change = preview.changes.find((c) => c.instanceId === 'i1')!;
    expect(change.changedFields).toContain('material');
    expect(change.changedFields).not.toContain('script');
    expect(change.preservedFields).toContain('script');
    // no mutation of caller state
    expect(instances).toEqual(frozen);
  });

  it('reimportPreview reports an instance override as preserved, not changed', () => {
    const version = createAssetVersion(baseSource);
    const instances = [makeInstance('i1', ['material'])];
    const preview = reimportPreview(baseSource, nextSource, version, instances);
    const change = preview.changes.find((c) => c.instanceId === 'i1')!;
    expect(change.changedFields).not.toContain('material');
    expect(change.preservedFields).toContain('material');
    expect(preview.affectedInstanceIds).not.toContain('i1');
  });

  it('reimportPreview rejects a missing source and selects no new version', () => {
    const version = createAssetVersion(baseSource);
    const preview = reimportPreview(baseSource, null, version, [makeInstance('i1')]);
    expect(preview.ok).toBe(false);
    expect(preview.reason).toBe('missing-source');
    expect(preview.toVersion).toBeNull();
    expect(preview.affectedInstanceIds).toEqual([]);
  });

  it('reimportPreview rejects an incompatible source (entityType mismatch)', () => {
    const version = createAssetVersion(baseSource);
    const incompatible: PrefabSnapshot = { ...nextSource, entityType: 'point_light' };
    const preview = reimportPreview(baseSource, incompatible, version, [makeInstance('i1')]);
    expect(preview.ok).toBe(false);
    expect(preview.reason).toBe('incompatible-source');
  });
});

describe('scene.FR-2.OP-03 transactional reimport with override preservation', () => {
  it('applyReimport updates non-protected fields, preserves transform/script and instance overrides, and bumps the version', () => {
    const version = createAssetVersion(baseSource);
    const instances = [
      makeInstance('i1'),
      makeInstance('i2', ['material']), // manual material override -> protected
    ];
    const result = applyReimport(baseSource, nextSource, version, instances);
    expect(result.ok).toBe(true);
    expect(result.version!.versionNumber).toBe(2);
    expect(result.version!.versionNumber).toBe(version.versionNumber + 1);
    expect(result.version!.sourceHash).toBe(hashSnapshot(nextSource));
    expect(result.version!.createdAt).toBe(version.createdAt); // createdAt preserved across bump

    const i1 = result.updatedInstances.find((i) => i.id === 'i1')!;
    // material tracks new source
    expect(i1.snapshot.material!.baseColor).toEqual([0.1, 0.8, 0.2, 1]);
    // script is a protected field -> preserved from the old source
    expect(i1.snapshot.script!.template).toBe('noop');

    const i2 = result.updatedInstances.find((i) => i.id === 'i2')!;
    // overridden material preserved despite new source
    expect(i2.snapshot.material!.baseColor).toEqual([0.5, 0.3, 0.15, 1]);
    expect(result.affectedInstanceIds).toEqual(['i1']);
  });

  it('applyReimport rejects a missing source and leaves version and instances untouched (no partial mutation)', () => {
    const version = createAssetVersion(baseSource);
    const instances = [makeInstance('i1')];
    const before = structuredClone(instances);
    const result = applyReimport(baseSource, null, version, instances);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing-source');
    expect(result.version).toBe(version); // prior version retained, same reference
    expect(instances).toEqual(before); // caller state untouched
    expect(result.updatedInstances).toEqual(before);
  });

  it('applyReimport rejects an incompatible source and retains the prior playable version', () => {
    const version = createAssetVersion(baseSource);
    const incompatible: PrefabSnapshot = { ...nextSource, entityType: 'sphere' };
    const instances = [makeInstance('i1')];
    const before = structuredClone(instances);
    const result = applyReimport(baseSource, incompatible, version, instances);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('incompatible-source');
    expect(result.version).toBe(version);
    expect(instances).toEqual(before);
  });

  it('applyReimport deletes a field that was explicitly null once the next source removes it entirely (#9812)', () => {
    // Regression: stableStringify() previously mapped both `null` and `undefined`
    // to the string 'null', so fieldsDiffer(null, undefined) reported "unchanged"
    // and a field explicitly set to null never got deleted when the source dropped it.
    const withNullField = { ...baseSource, physics: null } as unknown as PrefabSnapshot;
    const sourceWithoutField = { ...baseSource } as PrefabSnapshot; // physics key absent -> undefined
    const version = createAssetVersion(withNullField);
    const instance = makeInstance('i1', [], withNullField);
    expect(instance.snapshot).toHaveProperty('physics', null);

    const result = applyReimport(withNullField, sourceWithoutField, version, [instance]);
    expect(result.ok).toBe(true);
    expect(result.affectedInstanceIds).toContain('i1');
    const updated = result.updatedInstances.find((i) => i.id === 'i1')!;
    expect('physics' in (updated.snapshot as unknown as Record<string, unknown>)).toBe(false);
  });

  it('bumpAssetVersion increments and refreshes hash while preserving createdAt and protected fields', () => {
    const v1 = createAssetVersion(baseSource, ['transform']);
    const v2 = bumpAssetVersion(v1, nextSource);
    expect(v2.versionNumber).toBe(2);
    expect(v2.sourceHash).toBe(hashSnapshot(nextSource));
    expect(v2.createdAt).toBe(v1.createdAt);
    expect(v2.protectedFields).toEqual(['transform']);
    expect(v2.id).not.toBe(v1.id);
  });

  it('isCompatibleSource requires a truthy source with a matching entityType', () => {
    expect(isCompatibleSource(baseSource, nextSource)).toBe(true);
    expect(isCompatibleSource(baseSource, null)).toBe(false);
    expect(isCompatibleSource(baseSource, { ...nextSource, entityType: 'sphere' })).toBe(false);
  });
});

describe('scene.FR-2.OP-04 concurrent revision conflict and rollback', () => {
  it('detectVersionConflict returns a resolvable conflict for two competing revisions off the same base', () => {
    const base = createAssetVersion(baseSource);
    const revA: PrefabSnapshot = { ...baseSource, name: 'Crate A' };
    const revB: PrefabSnapshot = { ...baseSource, name: 'Crate B', material: nextSource.material };
    const conflict = detectVersionConflict(base, { label: 'A', source: revA }, { label: 'B', source: revB });
    expect(conflict.base).toBe(1);
    expect(conflict.resolvable).toBe(true);
    expect(conflict.divergentFields).toContain('name');
    expect(conflict.divergentFields).toContain('material');
    expect(conflict.candidates.map((c) => c.label)).toEqual(['A', 'B']);
  });

  it('resolveVersionConflict picks one revision and produces the next version (rollback to a single winner)', () => {
    const base = createAssetVersion(baseSource);
    const revA: PrefabSnapshot = { ...baseSource, name: 'Crate A' };
    const revB: PrefabSnapshot = { ...baseSource, name: 'Crate B' };
    const conflict = detectVersionConflict(base, { label: 'A', source: revA }, { label: 'B', source: revB });
    const resolved = resolveVersionConflict(conflict, 'B');
    expect(resolved.version.versionNumber).toBe(2);
    expect(resolved.chosenLabel).toBe('B');
    expect(resolved.source).toEqual(revB);
    expect(resolved.version.sourceHash).toBe(hashSnapshot(revB));
  });

  it('resolveVersionConflict throws for an unknown label rather than silently mutating', () => {
    const base = createAssetVersion(baseSource);
    const conflict = detectVersionConflict(
      base,
      { label: 'A', source: baseSource },
      { label: 'B', source: nextSource },
    );
    expect(() => resolveVersionConflict(conflict, 'C')).toThrow();
  });
});
