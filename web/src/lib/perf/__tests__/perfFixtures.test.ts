/**
 * The pinned 2D and 3D exported performance fixtures (#10013, operation
 * performance.FR-3.OP-01).
 *
 * Three things are pinned here, and each fails on its own:
 *  1. the committed JSON is exactly what the builders emit (the builders are the
 *     provenance; a hand edit to the JSON fails here),
 *  2. the checksum registered for each fixture is the checksum of that JSON (a
 *     content change must mint a new fixture version, not silently keep the id),
 *  3. each fixture is the workload its id claims: the 2D one is sprites under 2D
 *     physics, the 3D one lit PBR meshes under 3D physics.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeSceneFixtureChecksum, UNKNOWN } from '@/lib/config/measurementManifest';
import {
  PERF_FIXTURES,
  getPerfFixture,
  perfFixtureForChecksum,
  describeFixtureIdentity,
} from '../perfFixtures';
import { buildPerfFixtureScene, serializeFixtureScene, PERF_FIXTURE_FILES } from '../fixtures/fixtureScenes';

const FIXTURE_DIR = join(__dirname, '..', 'fixtures');

function committed(id: string): { text: string; scene: Record<string, unknown> } {
  const text = readFileSync(join(FIXTURE_DIR, PERF_FIXTURE_FILES[id]), 'utf8');
  return { text, scene: JSON.parse(text) as Record<string, unknown> };
}

type Entity = Record<string, unknown> & { entityId: string; entityType: string };

describe('perf fixture registry', () => {
  it('registers exactly one 2D and one 3D fixture', () => {
    expect(PERF_FIXTURES.map((f) => [f.id, f.dimension])).toEqual([
      ['perf-2d@1', '2d'],
      ['perf-3d@1', '3d'],
    ]);
  });

  for (const fixture of PERF_FIXTURES) {
    describe(fixture.id, () => {
      it('commits exactly what the builder emits (line endings aside)', () => {
        const { text } = committed(fixture.id);
        expect(text.replace(/\r\n/g, '\n')).toBe(serializeFixtureScene(buildPerfFixtureScene(fixture.id)));
      });

      it('registers the checksum of the committed scene', () => {
        const { scene } = committed(fixture.id);
        const checksum = computeSceneFixtureChecksum(scene);
        expect(checksum).not.toBe(UNKNOWN);
        expect(fixture.checksum).toBe(checksum);
      });

      it('is a valid scene-file shape the engine decoder accepts (format 3, unique ids, finite transforms)', () => {
        const { scene } = committed(fixture.id);
        expect(scene.formatVersion).toBe(3);
        const entities = scene.entities as Entity[];
        expect(entities.length).toBeGreaterThan(100);
        expect(new Set(entities.map((e) => e.entityId)).size).toBe(entities.length);
        for (const entity of entities) {
          const t = entity.transform as { position: number[]; rotation: number[]; scale: number[] };
          expect([...t.position, ...t.rotation, ...t.scale].every(Number.isFinite)).toBe(true);
          expect(t.rotation).toHaveLength(4);
          expect(typeof entity.visible).toBe('boolean');
          expect(typeof entity.physicsEnabled).toBe('boolean');
        }
      });

      it('is found again from its checksum, and nothing else is', () => {
        expect(perfFixtureForChecksum(fixture.checksum)?.id).toBe(fixture.id);
        expect(getPerfFixture(fixture.id)).toBe(fixture);
      });
    });
  }

  it('the 2D fixture is sprites under 2D physics over a static ground', () => {
    const entities = committed('perf-2d@1').scene.entities as Entity[];
    const sprites = entities.filter((e) => e.entityType === 'sprite');
    expect(sprites).toHaveLength(entities.length);
    const dynamic = sprites.filter(
      (e) => e.physics2dEnabled === true && (e.physics2dData as { body_type: string }).body_type === 'Dynamic',
    );
    expect(dynamic.length).toBeGreaterThanOrEqual(256);
    expect(sprites.some((e) => (e.physics2dData as { body_type: string } | undefined)?.body_type === 'Static')).toBe(true);
    // No 3D content hides in the 2D workload.
    expect(entities.some((e) => e.materialData ?? e.physicsData)).toBe(false);
  });

  it('the 3D fixture is lit PBR meshes under 3D physics over a fixed ground', () => {
    const entities = committed('perf-3d@1').scene.entities as Entity[];
    const meshes = entities.filter((e) => ['cube', 'sphere', 'cylinder', 'plane'].includes(e.entityType));
    const lights = entities.filter((e) => e.entityType.endsWith('_light'));
    expect(lights.some((e) => e.entityType === 'directional_light')).toBe(true);
    expect(lights.filter((e) => e.entityType === 'point_light').length).toBeGreaterThanOrEqual(4);
    const dynamic = meshes.filter(
      (e) => e.physicsEnabled === true && (e.physicsData as { bodyType: string }).bodyType === 'dynamic',
    );
    expect(dynamic.length).toBeGreaterThanOrEqual(216);
    expect(meshes.every((e) => e.materialData)).toBe(true);
    expect(entities.some((e) => e.spriteData ?? e.physics2dData)).toBe(false);
  });

  it('unknown and unregistered identities stay unrecognized', () => {
    expect(perfFixtureForChecksum(UNKNOWN)).toBeNull();
    expect(perfFixtureForChecksum('00000000')).toBeNull();
    expect(getPerfFixture('perf-2d@2')).toBeNull();
    expect(getPerfFixture('toString')).toBeNull();
  });

  it('labels a pinned checksum with its fixture id and anything else honestly', () => {
    const pinned = PERF_FIXTURES[1];
    expect(describeFixtureIdentity(pinned.checksum)).toEqual({ id: pinned.id, checksum: pinned.checksum });
    expect(describeFixtureIdentity('abcdef01')).toEqual({ id: 'unpinned-scene', checksum: 'abcdef01' });
    expect(describeFixtureIdentity(UNKNOWN)).toEqual({ id: UNKNOWN, checksum: UNKNOWN });
  });
});
