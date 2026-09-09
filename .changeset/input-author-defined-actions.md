---
"web": minor
---

**Input actions belong to the creator, not to a genre.**

A new project used to respond to no key at all: `InputMap::default()` was an
empty map, and the only thing that ever filled it was one of four genre presets
(`fps`, `platformer`, `topdown`, `racing`). Choosing a genre was the price of
having a keyboard, and a game that was none of those four had no vocabulary.

A new scene now starts with thirteen actions named for the input rather than for
a kind of game — `move_left`/`move_right`/`move_up`/`move_down`,
`move_forward`/`move_backward` on the same keys, the `move_horizontal` and
`move_vertical` axes, `jump`, `interact`, `pause`, `action_primary`,
`action_secondary` — and every one of them can be renamed, rebound or deleted.

Three things that made input genre-shaped are fixed with it:

- A template's own declared actions were discarded on load, so shipped content
  could only ever speak a preset. They are honoured now, which is what lets a
  game define `grapple`, `rewind` or a second player's controls.
- A scene file had to state a complete input map or fail to load. Omitting it
  now means "use the defaults".
- Applying a preset **replaced** every action the project had, including ones
  the creator authored. Presets merge now; removing a binding is an explicit act
  on a named action.

**Fixes movement that never worked.** The four action names every shipped and
generated script used — `move_left`, `move_right`, `move_forward`,
`move_backward` — were defined by no preset, so movement was dead in all eleven
templates. Under `fps` an axis reports pressed in both directions, so
`isPressed('move_forward')` was true for W *or* S while `isPressed('move_left')`
was never true: the player could not walk left, and walking backwards read as
walking forwards. Both AI system prompts taught those names, so generated games
were born with it.
