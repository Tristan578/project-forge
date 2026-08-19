---
'web': minor
---

Generated games are now playable: the pipeline builds a world and a goal

Two gaps meant that nearly every game the pipeline produced could not be
started at all. A GDD's `world` system described ground, platforms and bounds
that nothing ever spawned, so the player landed in an empty room; and only a
`progression` system planned a win condition, which most designs never declare,
so `validateWinnability` answered `NO_WIN_CONDITION` and the Play button
refused before dispatching anything.

- `world` now turns `worldConfig` into real geometry — ground, platforms and
  bounds — in both 2D and 3D.
- Every plan is guaranteed a satisfiable win condition, bound to the player by
  engine id. It defers to a real progression system rather than adding a second
  rule the player was never told about, and where there is nothing in the world
  to carry a goal it says so instead of emitting a component the engine would
  reject.
- New `progression`, `feedback`, `entities` and `challenge` system definitions
  emit real `add_game_component` steps (win conditions, health, collectibles,
  damage zones) instead of falling through to generated scripts.
- `verify_all_scenes` now asserts winnability and fails the plan when a game
  cannot be won, rather than reporting a playability it never checked.
