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
      `version: fixture is ${game.version + 1} but its expected-state record is for ${game.version}`,
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
