/**
 * #10159 — integrity of the two versioned reference games.
 *
 * A reference game is only useful as a regression oracle if "the same game"
 * means the same bytes. Each fixture therefore carries a `version`, and beside
 * it a hand-written expected-state record pinned to that version and to a
 * digest of the fixture's content. This suite holds the two together:
 *
 * - a version bump that leaves the record behind fails (the record still names
 *   the old version);
 * - a content edit that leaves the version alone fails (the digest moved);
 * - a record that disagrees with the fixture it describes fails (every fact the
 *   engine spec reads off the record is re-derived from the fixture here).
 *
 * The first two are also exercised on mutated clones below, so the checker is
 * shown to go red for exactly the reasons it exists, not merely to be green
 * on today's data.
 */
import { describe, it, expect } from 'vitest';
import { REFERENCE_GAMES } from '../../fixtures/reference-games';
import {
  REFERENCE_GAME_SET,
  MAX_REFERENCE_GAME_ENTITIES,
  type ReferenceGame,
} from '../../fixtures/reference-games/referenceGame';
import {
  contentDigest,
  deriveExpectedState,
  expectedStateProblems,
} from '../../fixtures/reference-games/verify';
import { boxOf, walkRightRoute, walkRoute } from '../../fixtures/reference-games/walkRoute';
import { SPAWNABLE_ENTITY_TYPES } from '@/stores/slices/sceneGraphSlice';
import { normalizeGameComponent, toWireComponent } from '@/lib/engine/gameComponentWire';

/** A deep copy that can be mutated without touching the shared fixture. */
function clone(game: ReferenceGame): ReferenceGame {
  return structuredClone(game);
}

describe('reference game registry (#10159)', () => {
  it('holds exactly the 2D and 3D members of the qa-score3-v1 set', () => {
    expect(REFERENCE_GAMES).toHaveLength(2);
    expect(REFERENCE_GAMES.map(({ game }) => game.set)).toEqual([REFERENCE_GAME_SET, REFERENCE_GAME_SET]);
    expect(REFERENCE_GAMES.map(({ game }) => game.member).sort()).toEqual(['2d', '3d']);
    const ids = REFERENCE_GAMES.map(({ game }) => game.fixtureId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { game } of REFERENCE_GAMES) {
      expect(game.fixtureId.startsWith(`${REFERENCE_GAME_SET}/`)).toBe(true);
      expect(Number.isInteger(game.version) && game.version >= 1).toBe(true);
    }
  });
});

for (const { game, expected } of REFERENCE_GAMES) {
  describe(`${game.fixtureId}@${game.version}`, () => {
    it('matches its expected-state record (version, digest and every derived fact)', () => {
      expect(expectedStateProblems(game, expected)).toEqual([]);
    });

    it('is small: at most ten entities, each with a unique id and name', () => {
      expect(game.entities.length).toBeGreaterThan(0);
      expect(game.entities.length).toBeLessThanOrEqual(MAX_REFERENCE_GAME_ENTITIES);
      expect(new Set(game.entities.map((e) => e.id)).size).toBe(game.entities.length);
      expect(new Set(game.entities.map((e) => e.name)).size).toBe(game.entities.length);
    });

    it('uses only entity types the engine spawns from a spawn_entity command', () => {
      // Any other type is dropped by `apply_spawn_requests` and `spawnEntity`
      // returns undefined for it, so the engine spec could never build it.
      for (const entity of game.entities) {
        expect(SPAWNABLE_ENTITY_TYPES.has(entity.entityType), entity.id).toBe(true);
      }
    });

    it('matches its project type: 2D physics in the 2D game, 3D physics in the 3D game', () => {
      expect(game.projectType).toBe(game.member);
      const dimensions = new Set(
        game.entities.flatMap((e) => (e.physics ? [e.physics.dimension] : [])),
      );
      expect([...dimensions]).toEqual([game.member]);
    });

    it('declares components the store and the engine hold identically', () => {
      // `addGameComponent` normalizes before both the store write and the
      // dispatch, and the engine clamps the same fields. A fixture value that
      // normalization would change is one the engine would hold differently
      // from the expected-state record.
      let checked = 0;
      for (const entity of game.entities) {
        for (const component of entity.gameComponents) {
          expect(normalizeGameComponent(component), `${entity.id}.${component.type}`).toEqual(component);
          expect(toWireComponent(component).componentType, `${entity.id}.${component.type}`).toMatch(/^[a-z_]+$/);
          checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(0);
    });

    it('carries win and lose mechanics: one win condition, a respawning player and a damage zone', () => {
      const winners = game.entities.filter((e) => e.gameComponents.some((c) => c.type === 'winCondition'));
      expect(winners.map((e) => e.id)).toEqual([game.winConditionEntityId]);
      expect(expected.lose.respawnOnDeath).toBe(true);
      expect(expected.lose.damageZoneEntityIds.length).toBeGreaterThan(0);
      expect(expected.win.playerEntityId).toBe(expected.lose.playerEntityId);
    });

    it('declares input bindings for the actions its character controller reads', () => {
      expect(game.inputBindings.length).toBeGreaterThan(0);
      expect(Object.keys(expected.inputActions).sort()).toEqual(
        game.inputBindings.map((b) => b.actionName).sort(),
      );
      expect(Object.keys(expected.inputActions)).toContain('jump');
    });
  });
}

describe('the expected-state checker fails for the reasons it exists', () => {
  const { game, expected } = REFERENCE_GAMES[0];

  it('refuses a version bump that leaves the expected-state record behind', () => {
    const bumped = clone(game);
    bumped.version = game.version + 1;

    const problems = expectedStateProblems(bumped, expected);

    expect(problems).toContain(
      `version: fixture is ${game.version + 1} but its expected-state record is for ${expected.version}`,
    );
  });

  it('refuses a content edit that does not bump the version', () => {
    const edited = clone(game);
    edited.entities[0].position = [99, 99, 0];

    const problems = expectedStateProblems(edited, expected);

    expect(contentDigest(edited)).not.toBe(expected.contentDigest);
    expect(problems.some((p) => p.startsWith('contentDigest:'))).toBe(true);
  });

  it('refuses a record whose facts disagree with the fixture', () => {
    const stale = structuredClone(expected);
    const [firstId] = Object.keys(stale.entities);
    stale.entities[firstId].gameComponents = [];

    const problems = expectedStateProblems(game, stale);

    expect(problems.some((p) => p.startsWith('derived state:'))).toBe(true);
  });

  it('derives the same record the fixture ships with, minus the digest', () => {
    const { contentDigest: _digest, ...rest } = expected;
    expect(deriveExpectedState(game)).toEqual(rest);
  });
});

/**
 * #10378 — what the 2D reference game's route may ask of the player.
 *
 * A 2D project takes the legacy direct-translation branch of the character
 * controller: walking moves the transform, a jump is a one-frame nudge, and the
 * body can only fall. So a route that climbs, or that needs a jump to cross a
 * gap, describes a game nobody can win. `walkRightRoute` sweeps the player's
 * box from its spawn to the goal over the fixture's own geometry; the cases
 * below hold the shipped game to a route it can walk, and hold the checker to
 * going red for each way a future edit could break that.
 */
describe('the 2D reference game can be won by walking right (#10159, #10378)', () => {
  function the2dGame(): ReferenceGame {
    const entry = REFERENCE_GAMES.find(({ game }) => game.member === '2d');
    if (!entry) throw new Error('the registry holds no 2D reference game');
    return entry.game;
  }

  /** A clone of the 2D game with `change` applied to the entity `id`. */
  function edited(id: string, change: (entity: ReferenceGame['entities'][number]) => void): ReferenceGame {
    const game = clone(the2dGame());
    const entity = game.entities.find((e) => e.id === id);
    if (!entity) throw new Error(`the 2D game has no entity "${id}"`);
    change(entity);
    return game;
  }

  // bevy_rapier2d multiplies every collider by the entity's transform scale, and the
  // engine inserts no `ColliderScale` (`make_collider_2d` in
  // `engine/src/core/physics_2d_sim.rs` builds `Collider::cuboid(size / 2)` and
  // `Collider::ball(radius)`), so a collider's `size` is in LOCAL units and the scale
  // gives the world extent. The web's own default is `size: [1, 1]`.
  it('expresses every 2D collider in local units: the unit shape, with the transform scale carrying the world extent', () => {
    const game = the2dGame();
    let checked = 0;
    for (const entity of game.entities) {
      if (entity.physics?.dimension !== '2d') continue;
      const { colliderShape, size, radius } = entity.physics.data;
      if (colliderShape === 'box') {
        // Setting `size` to the scale as well would be applied twice: a 7-wide scale
        // with a 7-wide size is a 49-wide collider.
        expect(size, `${entity.id} box size`).toEqual([1, 1]);
      } else if (colliderShape === 'circle') {
        // The unit circle spans the same 1-unit diameter as a unit box, so a uniform
        // scale is its world diameter.
        expect(radius, `${entity.id} circle radius`).toBe(0.5);
        expect(entity.scale[0], `${entity.id} circle scale`).toBe(entity.scale[1]);
      } else {
        throw new Error(`${entity.id}: ${colliderShape} is not a shape the walk-route model measures`);
      }
      checked += 1;
    }
    expect(checked).toBe(game.entities.length);
  });

  it('places every collider where the layout puts it, whatever the transform scale does to its local size', () => {
    // Written out by hand from the header's layout, not derived from the fixture's own
    // scales, so a double-scaled collider cannot satisfy it by agreeing with itself.
    const worldExtents: Record<string, { x: [number, number]; y: [number, number] }> = {
      player: { x: [-5.4, -4.6], y: [0.1, 0.9] },
      ledge_start: { x: [-8, -1], y: [-1, 0] },
      spike_pit: { x: [-10, -8], y: [-3, 0.5] },
      left_bank: { x: [-14, -10], y: [-1, 0] },
      coin: { x: [2.25, 2.75], y: [0.15, 0.65] },
      ledge_end: { x: [-1, 8], y: [-1, 0] },
      goal: { x: [6.75, 7.25], y: [0, 1.5] },
    };
    const game = the2dGame();
    expect(game.entities.map((e) => e.id).sort()).toEqual(Object.keys(worldExtents).sort());
    for (const entity of game.entities) {
      const box = boxOf(entity);
      const want = worldExtents[entity.id];
      expect(box.minX, `${entity.id} minX`).toBeCloseTo(want.x[0], 9);
      expect(box.maxX, `${entity.id} maxX`).toBeCloseTo(want.x[1], 9);
      expect(box.minY, `${entity.id} minY`).toBeCloseTo(want.y[0], 9);
      expect(box.maxY, `${entity.id} maxY`).toBeCloseTo(want.y[1], 9);
    }
  });

  it('measures a collider the way the engine builds it: local size times the transform scale', () => {
    // The shape the fixture had before v3: `size` equal to `scale`. The engine
    // simulates 7 x 7 = a 49-wide start ledge, so the checker has to report 49 and
    // not the 7 the author meant.
    const doubled = edited('ledge_start', (e) => {
      if (e.physics?.dimension === '2d') e.physics.data.size = [e.scale[0], e.scale[1]];
    });
    const ledge = doubled.entities.find((e) => e.id === 'ledge_start');
    if (!ledge) throw new Error('the 2D game has no ledge_start');

    const box = boxOf(ledge);

    expect(box.maxX - box.minX).toBe(49);
    expect(box.maxY - box.minY).toBe(1);
  });

  it.each([
    { radius: 0.5, scale: 2, diameter: 2 },
    { radius: 0.25, scale: 2, diameter: 1 },
    { radius: 0.5, scale: 0.5, diameter: 0.5 },
  ])('measures a circle collider as its radius times the transform scale ($radius x $scale)', ({ radius, scale, diameter }) => {
    const round = edited('coin', (e) => {
      if (e.physics?.dimension === '2d') {
        e.physics.data.colliderShape = 'circle';
        e.physics.data.radius = radius;
      }
      e.scale = [scale, scale, scale];
    });
    const coin = round.entities.find((e) => e.id === 'coin');
    if (!coin) throw new Error('the 2D game has no coin');

    const box = boxOf(coin);

    expect(box.maxX - box.minX).toBeCloseTo(diameter, 9);
    expect(box.maxY - box.minY).toBeCloseTo(diameter, 9);
  });

  it('refuses to measure a collider shape it does not model, rather than guess its extent', () => {
    const capsule = edited('player', (e) => {
      if (e.physics?.dimension === '2d') e.physics.data.colliderShape = 'capsule';
    });
    const player = capsule.entities.find((e) => e.id === 'player');
    if (!player) throw new Error('the 2D game has no player');

    expect(() => boxOf(player)).toThrow(/capsule/);
  });

  it('walks from the spawn to the goal over a floor that never rises, collecting the coin and touching no damage zone', () => {
    const game = the2dGame();

    const report = walkRightRoute(game);

    expect(report.problems).toEqual([]);
    expect(report.surfaces).toEqual(['ledge_start', 'ledge_end']);
    expect(report.collected).toEqual(['coin']);
    // The same property stated straight off the data, so a bug in the sweep
    // cannot hide a climb from this test: each floor the player reaches is no
    // higher than the one before it.
    const tops = report.surfaces.map((id) => {
      const entity = game.entities.find((e) => e.id === id);
      return entity ? entity.position[1] + entity.scale[1] / 2 : Number.NaN;
    });
    expect(tops.length).toBeGreaterThan(1);
    tops.forEach((top, i) => {
      expect(Number.isFinite(top)).toBe(true);
      if (i > 0) expect(top).toBeLessThanOrEqual(tops[i - 1] + 1e-9);
    });
  });

  it.each([0.3, 0.1, 0.01])('refuses an end ledge that rises %s above the start ledge', (rise) => {
    const risen = edited('ledge_end', (e) => {
      e.position = [e.position[0], e.position[1] + rise, e.position[2]];
    });

    const { problems } = walkRightRoute(risen);

    expect(problems.some((p) => p.startsWith('climb:'))).toBe(true);
  });

  it('refuses a gap the box cannot straddle', () => {
    const split = edited('ledge_end', (e) => {
      e.position = [e.position[0] + 1, e.position[1], e.position[2]];
    });

    const { problems } = walkRightRoute(split);

    expect(problems.some((p) => p.startsWith('gap:'))).toBe(true);
  });

  it('accepts a step down onto an adjoining lower floor, which the shipped layout does not use', () => {
    // The checker lowers the floor once the box has cleared the higher ledge, so a
    // descent is not refused. The fixture header says the same: the layout avoids
    // a drop, the checker does not forbid one.
    const stepDown = edited('ledge_end', (e) => {
      e.position = [e.position[0], e.position[1] - 0.5, e.position[2]];
    });

    const report = walkRightRoute(stepDown);

    expect(report.problems).toEqual([]);
    expect(report.surfaces).toEqual(['ledge_start', 'ledge_end']);
  });

  it('refuses an opening lower than the box, and accepts one it fits under', () => {
    const withOverhang = (bottom: number) => {
      const game = clone(the2dGame());
      const overhang = structuredClone(game.entities.filter((e) => e.id === 'ledge_end')[0]);
      overhang.id = 'overhang';
      overhang.name = 'Overhang';
      overhang.scale = [2, 1, 1];
      overhang.position = [3, bottom + 0.5, 0];
      game.entities.push(overhang);
      return game;
    };

    expect(walkRightRoute(withOverhang(0.5)).problems.some((p) => p.startsWith('climb:'))).toBe(true);
    expect(walkRightRoute(withOverhang(0.9)).problems).toEqual([]);
  });

  it('loses by holding left: the box touches the spike pit without ever leaving the start ledge', () => {
    const game = the2dGame();

    const report = walkRoute(game, 'left', 'spike_pit');

    // No fall is needed, so the lose path does not depend on how far the body
    // drifts while it drops (which varies with the frame rate).
    expect(report.problems).toEqual([]);
    expect(report.surfaces).toEqual(['ledge_start']);
  });

  it('refuses a lose route whose damage zone the walk cannot reach', () => {
    // Sink the pit below the floor AND close the cavity it sat in, by widening the
    // left bank to meet the start ledge. The floor is then continuous all the way
    // past the pit, so the only thing wrong with the route is that the walk never
    // touches its target. (Sinking the pit alone leaves the 2-unit cavity between
    // the ledge and the bank, and the walk fails on that gap, not on the target.)
    const buried = edited('spike_pit', (e) => {
      e.position = [e.position[0], -3, e.position[2]];
    });
    const bank = buried.entities.find((e) => e.id === 'left_bank');
    if (!bank) throw new Error('the 2D game has no left_bank');
    // Only the scale changes: the collider's local size stays the unit box.
    bank.scale = [6, 1, 1];
    bank.position = [-11, bank.position[1], bank.position[2]];

    const { problems } = walkRoute(buried, 'left', 'spike_pit');

    // A gap ends the walk before the target check runs, so `target:` appearing at
    // all means the sweep got past the pit on a continuous floor.
    expect(problems.some((p) => p.startsWith('target:'))).toBe(true);
  });

  it('refuses a damage zone on the walk to the goal', () => {
    const onTheRoute = edited('spike_pit', (e) => {
      e.position = [2, 0.3, 0];
    });

    const { problems } = walkRightRoute(onTheRoute);

    expect(problems.some((p) => p.startsWith('hazard:'))).toBe(true);
  });

  it('refuses a coin the walk never touches', () => {
    const overhead = edited('coin', (e) => {
      e.position = [e.position[0], e.position[1] + 3, e.position[2]];
    });

    const { problems } = walkRightRoute(overhead);

    expect(problems.some((p) => p.startsWith('collectible:'))).toBe(true);
  });

  it('refuses a goal the walk passes without touching', () => {
    const overhead = edited('goal', (e) => {
      e.position = [e.position[0], e.position[1] + 3, e.position[2]];
    });

    const { problems } = walkRightRoute(overhead);

    expect(problems.some((p) => p.startsWith('target:'))).toBe(true);
  });

  // Both spawn refusals start with `spawn:`, and a player sunk into its only
  // support also has no floor under it, so a prefix check would stay green with
  // the embedded rule disabled. These pin the whole line instead.
  it('refuses a player spawned inside a support', () => {
    const sunk = edited('player', (e) => {
      e.position = [e.position[0], 0.2, e.position[2]];
    });

    const { problems } = walkRightRoute(sunk);

    expect(problems).toEqual(['spawn: the player starts inside ledge_start']);
  });

  it('refuses a player spawned with nothing solid under it', () => {
    const overTheCavity = edited('player', (e) => {
      e.position = [-9, e.position[1], e.position[2]];
    });

    const { problems } = walkRightRoute(overTheCavity);

    expect(problems).toEqual(['spawn: nothing solid is under the player at x=-9']);
  });
});
