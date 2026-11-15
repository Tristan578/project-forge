/**
 * The one precondition under which the progression system plans a win
 * condition, shared by the planner and the brief validator (#10174).
 *
 * `systems/progression.ts` is the only definition that plans a `winCondition`,
 * and it does not when the world is empty: the condition rides on an entity,
 * so with nothing placed there is nothing to win with, and the system drops
 * every step and warns instead. `briefSchema.ts` reports a progression system
 * in a goal-free mode (`sandbox`, `endless`) as `COMPLETION_MODE_CONFLICT` —
 * but only when progression would actually plan the goal the mode refuses. A
 * sandbox brief with no entities and a progression system is fine as it
 * stands, and saying otherwise would send the author to fix a contradiction
 * the build never produces.
 *
 * ONE function for both callers, so the planner's behaviour and the editor's
 * warning cannot drift apart. It lives in its own module rather than in
 * `progression.ts` because that file registers itself on load and
 * `systemRegistry.test.ts` pins the registration order: a validator that
 * imported it would register progression ahead of every other system. This
 * file has no side effects and imports nothing.
 */

/**
 * Whether the progression system plans a win condition for a world holding
 * `entities`: every entity in every scene, in declaration order, which is the
 * `ctx.entities` list `planBuilder` (Phase 2) hands each system definition.
 * The brief validator builds the same list from `scenes[].entities[]`.
 */
export function progressionPlansWinCondition(entities: ReadonlyArray<unknown>): boolean {
  return entities.length > 0;
}
