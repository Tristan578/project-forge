/**
 * #10159 — the two versioned reference games must pass the pre-play gate.
 *
 * `gameSlice.play()` runs `validateWinnability` and RETURNS without playing when
 * a scene is not winnable, honouring the scene's `completionMode`. Every
 * release journey that loads a reference game therefore depends on these two
 * fixtures staying winnable in `win` mode, and on the gate still refusing them
 * once their win-condition entity is gone. Both halves are pinned here against
 * the fixture data itself, so a fixture edit that breaks either one fails in
 * this suite before it can fail a slow engine journey.
 *
 * The graph and component map come from `toValidatorInput`, which keys both by
 * the fixture's own entity ids and resolves entity references (a `reachGoal`
 * target) through the same `resolveEntityRefs` the engine spec uses with the
 * runtime ids.
 */
import { describe, it, expect } from 'vitest';
import { validateWinnability } from '../winnabilityValidator';
import { REFERENCE_GAMES } from '../../../../e2e/fixtures/reference-games';
import {
  toValidatorInput,
  withoutEntity,
} from '../../../../e2e/fixtures/reference-games/referenceGame';

describe('reference games pass the pre-play winnability gate (#10159)', () => {
  it('covers exactly the 2D and 3D members of the qa-score3-v1 set', () => {
    // A registry that silently lost a member would make every loop below
    // vacuous for it, so the membership is asserted, not assumed.
    expect(REFERENCE_GAMES.map(({ game }) => game.member).sort()).toEqual(['2d', '3d']);
  });

  for (const { game } of REFERENCE_GAMES) {
    describe(`${game.fixtureId}@${game.version}`, () => {
      it(`is winnable in its declared completion mode (${game.completionMode})`, () => {
        expect(game.completionMode).toBe('win');
        const { sceneGraph, allGameComponents } = toValidatorInput(game);
        // The walk must not be empty: a scene with no components at all is the
        // one input where "no issues" would mean "nothing was checked".
        expect(Object.keys(sceneGraph.nodes)).toHaveLength(game.entities.length);

        const report = validateWinnability(sceneGraph, allGameComponents, game.completionMode);

        expect(report).toEqual({ winnable: true, issues: [] });
      });

      it('is NOT winnable once its win-condition entity is removed', () => {
        const stripped = withoutEntity(game, game.winConditionEntityId);
        // Exactly one entity went, and it was the one carrying the win
        // condition — otherwise the refusal below could be for another reason.
        expect(stripped.entities).toHaveLength(game.entities.length - 1);
        expect(stripped.entities.some((e) => e.id === game.winConditionEntityId)).toBe(false);
        const { sceneGraph, allGameComponents } = toValidatorInput(stripped);

        const report = validateWinnability(sceneGraph, allGameComponents, game.completionMode);

        expect(report.winnable).toBe(false);
        expect(report.issues.map((issue) => issue.code)).toEqual(['NO_WIN_CONDITION']);
      });
    });
  }
});
