/**
 * Registry of the pinned performance fixtures (#10013, operation
 * performance.FR-3.OP-01).
 *
 * Deliberately metadata only: the scene JSON lives in
 * `fixtures/perf-*-v*.scene.json` and is read by the harness, the E2E capture
 * and the tests — never imported here — so recognising a fixture from its
 * checksum costs the editor bundle a few strings rather than ~340 KB of scene.
 *
 * `checksum` is `computeSceneFixtureChecksum` of the committed file, pinned by
 * `__tests__/perfFixtures.test.ts`. Two reports are only comparable when their
 * checksums match, so an edited fixture must be registered as a new version.
 */
import { UNKNOWN, type Unknown } from '@/lib/config/measurementManifest';

/** One pinned exported fixture. */
export interface PerfFixture {
  /** `name@version`. */
  id: string;
  dimension: '2d' | '3d';
  label: string;
  description: string;
  /** Canonical scene checksum of the committed fixture file. */
  checksum: string;
}

/** Every pinned fixture, 2D first. */
export const PERF_FIXTURES: readonly Readonly<PerfFixture>[] = Object.freeze([
  Object.freeze({
    id: 'perf-2d@1',
    dimension: '2d',
    label: '2D sprites + 2D physics',
    description: '256 dynamic untextured sprites (boxes and circles) falling under 2D physics onto a static ground sprite.',
    checksum: 'b620e09f',
  }),
  Object.freeze({
    id: 'perf-3d@1',
    dimension: '3d',
    label: '3D PBR meshes + 3D physics',
    description:
      '216 dynamic PBR meshes (cubes, spheres, cylinders) dropping under 3D physics onto a fixed ground, lit by a shadow-casting sun and four point lights.',
    checksum: '5e285ced',
  }),
] as const satisfies readonly PerfFixture[]);

/** Label for a measured scene that is not one of the pinned fixtures. */
export const UNPINNED_SCENE_ID = 'unpinned-scene';

/**
 * Look up a fixture by id.
 * @param id `name@version`.
 * @returns The fixture, or null when not registered.
 */
export function getPerfFixture(id: string): Readonly<PerfFixture> | null {
  return PERF_FIXTURES.find((f) => f.id === id) ?? null;
}

/**
 * Recognise a pinned fixture from a measured scene's checksum.
 * @param checksum Canonical scene checksum, or unknown.
 * @returns The fixture whose committed scene has this checksum, or null.
 */
export function perfFixtureForChecksum(checksum: string | Unknown): Readonly<PerfFixture> | null {
  if (checksum === UNKNOWN) return null;
  return PERF_FIXTURES.find((f) => f.checksum === checksum) ?? null;
}

/**
 * The fixture identity a report carries: a pinned id when the checksum is one,
 * `unpinned-scene` for any other measured scene, and unknown when the scene
 * could not be read at all.
 * @param checksum Canonical scene checksum, or unknown.
 * @returns `{ id, checksum }` for the report.
 */
export function describeFixtureIdentity(checksum: string | Unknown): { id: string | Unknown; checksum: string | Unknown } {
  if (checksum === UNKNOWN) return { id: UNKNOWN, checksum: UNKNOWN };
  return { id: perfFixtureForChecksum(checksum)?.id ?? UNPINNED_SCENE_ID, checksum };
}
