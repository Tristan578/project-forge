/**
 * PF-1138 — `worldConfig` used to be parsed by `scene_create` and then dropped,
 * so every generated game was an empty room. These tests pin the pure builder
 * that turns a model-authored world config into concrete spawn descriptors.
 *
 * The hostile-input cases are the point of the suite, not decoration: the config
 * is written by an LLM, so every number is a candidate NaN and every array is a
 * candidate sparse array.
 */

import { describe, it, expect } from 'vitest';
import {
  buildWorldGeometry,
  MAX_PLATFORMS,
  MAX_WORLD_DESCRIPTORS,
} from '../worldGeometry';

function build3d(worldConfig: unknown, worldType = 'flat') {
  return buildWorldGeometry({ worldType, worldConfig, projectType: '3d' });
}

function build2d(worldConfig: unknown, worldType = 'flat') {
  return buildWorldGeometry({ worldType, worldConfig, projectType: '2d' });
}

describe('buildWorldGeometry — the empty case', () => {
  it('still produces a ground for an empty config, because an empty room is the bug', () => {
    const { descriptors, warnings } = build3d({});

    expect(descriptors).toEqual([
      {
        role: 'ground',
        name: 'Ground',
        entityType: 'cube',
        position: [0, -0.5, 0],
        scale: [40, 1, 40],
      },
    ]);
    expect(warnings).toEqual([]);
  });

  it('produces a ground when worldConfig is absent entirely', () => {
    const { descriptors } = buildWorldGeometry({ projectType: '3d' });
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0].role).toBe('ground');
  });

  it('drops a non-object worldConfig with a warning and still grounds the scene', () => {
    const { descriptors, warnings } = build3d('a big forest');

    expect(descriptors).toHaveLength(1);
    expect(descriptors[0].role).toBe('ground');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/world/i);
  });
});

describe('buildWorldGeometry — a plain 3D config', () => {
  it('sizes the ground, lays a platform run, and encloses the world', () => {
    const { descriptors, warnings } = build3d({
      width: 30,
      depth: 20,
      platformCount: 3,
      bounds: true,
    });

    expect(warnings).toEqual([]);
    expect(descriptors).toEqual([
      { role: 'ground', name: 'Ground', entityType: 'cube', position: [0, -0.5, 0], scale: [30, 1, 20] },
      { role: 'platform', name: 'Platform 1', entityType: 'cube', position: [-7.5, 2, 0], scale: [6, 1, 6] },
      { role: 'platform', name: 'Platform 2', entityType: 'cube', position: [0, 4, 0], scale: [6, 1, 6] },
      { role: 'platform', name: 'Platform 3', entityType: 'cube', position: [7.5, 6, 0], scale: [6, 1, 6] },
      { role: 'wall', name: 'Wall North', entityType: 'cube', position: [0, 2, -10], scale: [30, 4, 1] },
      { role: 'wall', name: 'Wall South', entityType: 'cube', position: [0, 2, 10], scale: [30, 4, 1] },
      { role: 'wall', name: 'Wall East', entityType: 'cube', position: [15, 2, 0], scale: [1, 4, 20] },
      { role: 'wall', name: 'Wall West', entityType: 'cube', position: [-15, 2, 0], scale: [1, 4, 20] },
    ]);
  });

  it('reads a size keyword and the grid spellings an LLM also uses', () => {
    expect(build3d({ size: 'small' }).descriptors[0].scale).toEqual([20, 1, 20]);
    expect(build3d({ size: 'large' }).descriptors[0].scale).toEqual([80, 1, 80]);
    expect(build3d({ gridWidth: 24, gridDepth: 12 }).descriptors[0].scale).toEqual([24, 1, 12]);
  });

  it('places explicit platforms exactly where the design put them', () => {
    const { descriptors } = build3d({
      platforms: [
        { x: -4, y: 3, z: 2, width: 8, height: 0.5, depth: 3 },
        [10, 6],
      ],
    });

    expect(descriptors.slice(1)).toEqual([
      { role: 'platform', name: 'Platform 1', entityType: 'cube', position: [-4, 3, 2], scale: [8, 0.5, 3] },
      { role: 'platform', name: 'Platform 2', entityType: 'cube', position: [10, 6, 0], scale: [6, 1, 6] },
    ]);
  });
});

describe('buildWorldGeometry — 2D', () => {
  it('builds side-scroller geometry in the XY plane, never in XZ', () => {
    const { descriptors } = build2d({ width: 40, platformCount: 2, bounds: true });

    expect(descriptors).toEqual([
      { role: 'ground', name: 'Ground', entityType: 'cube', position: [0, -0.5, 0], scale: [40, 1, 1] },
      { role: 'platform', name: 'Platform 1', entityType: 'cube', position: [-6.667, 2, 0], scale: [6, 1, 1] },
      { role: 'platform', name: 'Platform 2', entityType: 'cube', position: [6.667, 4, 0], scale: [6, 1, 1] },
      { role: 'wall', name: 'Wall East', entityType: 'cube', position: [20, 2, 0], scale: [1, 4, 1] },
      { role: 'wall', name: 'Wall West', entityType: 'cube', position: [-20, 2, 0], scale: [1, 4, 1] },
    ]);
  });

  it('ignores a depth the 2D view cannot show, and says so', () => {
    const { descriptors, warnings } = build2d({ width: 30, depth: 25 });

    expect(descriptors[0].scale).toEqual([30, 1, 1]);
    expect(warnings.join(' ')).toMatch(/depth/i);
  });
});

describe('buildWorldGeometry — worldType inference', () => {
  it('gives a platformer a platform run even when the config names none', () => {
    const { descriptors } = build3d({}, 'platformer');
    const platforms = descriptors.filter(d => d.role === 'platform');
    expect(platforms.length).toBeGreaterThan(0);
  });

  it('does not invent platforms for a world type that did not ask for them', () => {
    const { descriptors } = build3d({}, 'terrain');
    expect(descriptors.filter(d => d.role === 'platform')).toHaveLength(0);
  });
});

describe('buildWorldGeometry — hostile config', () => {
  it('falls back to defaults for NaN and Infinity rather than sending them to the engine', () => {
    const { descriptors, warnings } = build3d({ width: Number.NaN, depth: Number.POSITIVE_INFINITY });

    expect(descriptors[0].scale).toEqual([40, 1, 40]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('rejects a negative or zero world size', () => {
    expect(build3d({ width: -50, depth: 0 }).descriptors[0].scale).toEqual([40, 1, 40]);
  });

  it('clamps an absurd world size instead of dropping the ground', () => {
    const { descriptors } = build3d({ width: 1e12, depth: 1e-12 });
    expect(descriptors[0].scale).toEqual([400, 1, 4]);
  });

  it('clamps an absurd platform count', () => {
    const { descriptors, warnings } = build3d({ platformCount: 1e9 });
    expect(descriptors.filter(d => d.role === 'platform')).toHaveLength(MAX_PLATFORMS);
    expect(warnings.join(' ')).toMatch(/platform/i);
  });

  /**
   * This used to assert `toBeLessThanOrEqual(MAX_WORLD_DESCRIPTORS)`, which is
   * true for every possible input — the builder can emit at most one ground,
   * MAX_PLATFORMS platforms and the bounding walls, so the cap is unreachable
   * and both the assertion and the truncation block it appeared to cover had
   * zero coverage. Assert the exact composition instead.
   */
  it('caps the platform run and emits nothing beyond ground + platforms + walls', () => {
    const platforms: unknown[] = [];
    for (let i = 0; i < 500; i += 1) platforms.push({ x: i, y: 1 });
    const { descriptors, warnings } = build3d({ platforms, bounds: true });

    // Indexed reads, never `.filter`/`.every`: those skip array holes, so a
    // sparse result would report itself clean.
    const byRole = new Map<string, number>();
    for (let i = 0; i < descriptors.length; i += 1) {
      const role = descriptors[i].role;
      byRole.set(role, (byRole.get(role) ?? 0) + 1);
    }

    expect(byRole.get('ground')).toBe(1);
    expect(byRole.get('platform')).toBe(MAX_PLATFORMS);
    expect(descriptors).toHaveLength(1 + MAX_PLATFORMS + (byRole.get('wall') ?? 0));
    // The platform clamp DID run and says so; the descriptor-cap truncation did
    // not, and must not claim it did. Match its own sentence, not the word the
    // two warnings happen to share.
    expect(warnings.join(' ')).toMatch(/platforms in the design could not be placed/i);
    expect(warnings.join(' ')).not.toMatch(/more than \d+ objects/i);
  });

  /**
   * The structural half of the pin: raising MAX_PLATFORMS above the cap would
   * arm the truncation block, and the test above would then be asserting a
   * composition the builder no longer produces. Fail here first, with a reason.
   */
  it('cannot reach the descriptor cap — the maximum output is pinned below it', () => {
    const { descriptors } = build3d({ platformCount: 0, bounds: true });
    let walls = 0;
    for (let i = 0; i < descriptors.length; i += 1) {
      if (descriptors[i].role === 'wall') walls += 1;
    }
    expect(walls).toBeGreaterThan(0);
    expect(1 + MAX_PLATFORMS + walls).toBeLessThanOrEqual(MAX_WORLD_DESCRIPTORS);
  });

  it('reads only own properties — an inherited width is not the design', () => {
    const polluted = Object.create({ width: 999, depth: 999, platformCount: 7 }) as Record<string, unknown>;
    const { descriptors } = build3d(polluted);

    expect(descriptors).toHaveLength(1);
    expect(descriptors[0].scale).toEqual([40, 1, 40]);
  });

  it('sees an array HOLE — a callback form would skip it and report the list fully processed', () => {
    // The hole IS the input under test. `.map`/`.every`/`.filter` never invoke
    // the callback for it, so a callback-based reader fails OPEN and the
    // resulting descriptor list silently loses a slot (or keeps a hole that
    // `for...of` later yields as `undefined`).
    const platforms = [{ x: -5, y: 2 }, , { x: 5, y: 4 }];
    const { descriptors, warnings } = build3d({ platforms });

    expect(Array.from(descriptors)).toEqual([
      { role: 'ground', name: 'Ground', entityType: 'cube', position: [0, -0.5, 0], scale: [40, 1, 40] },
      { role: 'platform', name: 'Platform 1', entityType: 'cube', position: [-5, 2, 0], scale: [6, 1, 6] },
      { role: 'platform', name: 'Platform 2', entityType: 'cube', position: [5, 4, 0], scale: [6, 1, 6] },
    ]);
    expect(warnings.join(' ')).toMatch(/platform/i);
  });

  it('treats a null entry the same as a hole — one JSON round trip turns one into the other', () => {
    const { descriptors, warnings } = build3d({ platforms: [null, { x: 1, y: 1 }] });
    expect(descriptors.filter(d => d.role === 'platform')).toHaveLength(1);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('drops a platform whose coordinates are not finite', () => {
    const { descriptors } = build3d({ platforms: [{ x: Number.NaN, y: 1 }, { x: 2, y: 3 }] });
    expect(descriptors.filter(d => d.role === 'platform')).toHaveLength(1);
  });

  it('clamps a platform scale to something the engine will accept', () => {
    // `update_transform` REJECTS the whole command when any scale component has
    // `abs < f32::EPSILON`, so a zero-width platform would take the entity's
    // transform with it.
    const { descriptors } = build3d({ platforms: [{ x: 0, y: 1, width: 0, height: -3, depth: 1e9 }] });
    const platform = descriptors[1];
    expect(platform.scale[0]).toBeGreaterThan(0);
    expect(platform.scale[1]).toBeGreaterThan(0);
    expect(platform.scale[2]).toBeLessThanOrEqual(1000);
  });

  it('reports config it did not understand rather than dropping it in silence', () => {
    const { warnings } = build3d({ biome: 'forest', weather: 'rain' });
    expect(warnings.join(' ')).toMatch(/biome/);
    expect(warnings.join(' ')).toMatch(/weather/);
  });

  it('emits every number finite, in range, and non-zero in scale', () => {
    const { descriptors } = build3d({
      width: 1e400,
      depth: Number.NaN,
      platformCount: 40,
      bounds: 'yes',
      platforms: [{ x: 1e400, y: -1e400, width: Number.NaN }],
    });

    for (let i = 0; i < descriptors.length; i += 1) {
      const d = descriptors[i];
      for (let a = 0; a < 3; a += 1) {
        expect(Number.isFinite(d.position[a])).toBe(true);
        expect(Math.abs(d.position[a])).toBeLessThanOrEqual(10_000);
        expect(Number.isFinite(d.scale[a])).toBe(true);
        expect(d.scale[a]).toBeGreaterThanOrEqual(0.01);
        expect(d.scale[a]).toBeLessThanOrEqual(1000);
      }
    }
  });
});

/**
 * A design key that is present but unusable must always produce an explanation
 * that matches the game the user actually got.
 *
 * Both of these are silent-failure shapes rather than crashes, which is why
 * they survived: the geometry that comes back is perfectly valid, and only the
 * words next to it are wrong or missing.
 */
describe('buildWorldGeometry — explaining an unusable key', () => {
  it('does not claim the default was used when another spelling supplied the size', () => {
    const { descriptors, warnings } = build3d({ width: 40, worldWidth: 'huge' });

    // The usable number is the one that reached the engine.
    const ground = descriptors.find(d => d.name === 'Ground');
    expect(ground?.scale[0]).toBe(40);

    // So an explanation saying the default was used instead would be false.
    const about = warnings.filter(w => w.includes('worldWidth'));
    expect(about).toHaveLength(1);
    expect(about[0]).not.toMatch(/default was used/i);
    expect(about[0]).toMatch(/written twice/i);
  });

  it('still says the default was used when no spelling supplied a usable size', () => {
    const { warnings } = build3d({ width: 'huge' });

    expect(warnings.join(' ')).toMatch(/default was used/i);
  });

  it('explains a walls flag the engine cannot read as yes or no', () => {
    // `walls` is consumed by the bounds reader, so the leftover-key sweep at the
    // end will never mention it. Without its own warning the design asks for an
    // enclosed level, gets an open one, and nothing anywhere says why.
    const { descriptors, warnings } = build3d({ width: 30, depth: 30, walls: 'yes' });

    expect(descriptors.some(d => d.name.startsWith('Wall'))).toBe(false);

    const about = warnings.filter(w => w.includes('walls'));
    expect(about.length).toBeGreaterThan(0);
    expect(about.join(' ')).toMatch(/yes or no/i);
  });

  it('keeps a usable walls flag and reports only the unusable spelling', () => {
    const { descriptors, warnings } = build3d({ width: 30, depth: 30, bounds: true, walls: 'yes' });

    expect(descriptors.some(d => d.name.startsWith('Wall'))).toBe(true);

    const about = warnings.filter(w => w.includes('"walls"'));
    expect(about).toHaveLength(1);
    expect(about[0]).toMatch(/twice/i);
  });

  it('says nothing when every flag is a real boolean', () => {
    const { warnings } = build3d({ width: 30, depth: 30, bounds: false });
    expect(warnings).toEqual([]);
  });
});
