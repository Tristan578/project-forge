---
"web": patch
---

Stop undo from switching 2D physics, tilemap rendering, or 2D skeletal animation
on for an entity the user disabled.

Three `UndoableAction` variants — `Physics2dChange`, `TilemapChange`,
`SkeletonChange` — each record a change to their data component and nothing
else. Enablement lives in a separate marker (`Physics2dEnabled`,
`TilemapEnabled`, `SkeletonEnabled2d`). All three had undo and redo arms that
inserted that marker alongside the restored data, so undoing *any* property edit
started simulating, rendering, or animating an entity that had been deliberately
switched off. The 3D `PhysicsChange` arm has always got this right: it mutates
the data in place and never touches `PhysicsEnabled`.

"Data present, marker absent" is a state the engine deliberately round-trips —
every other restore path reinstates these markers conditionally from a recorded
bool (`insert_aux_components`, `spawn_from_snapshot`, and the play-mode snapshot
restore in `engine_mode.rs`). An action that records no enablement must not
invent one.

Nothing surfaced it. The inspectors read the data, not the marker, so the panels
looked correct while the body began falling; and because the marker is what the
lifecycle systems key on, the recovery is not another undo — the user has to
find and un-toggle a switch they never touched.

All six arms now restore the data only. Each `None` branch still clears the
marker with the data, because a marker with no data is a state no command can
produce (the bridge inserts and removes each pair together), and that asymmetry
is now written down where the arms are. Fifteen native regression tests pin the
disabled case, the redo mirror, the enabled case in the opposite direction, and
both `None` branches for each component. Every fixture is deliberately off its
type's `Default` on the fields it asserts, so a regression inserting a blank
struct fails instead of coincidentally passing — measured by mutation: reverting
the data restore reddens the physics tests, and reinstating either unconditional
marker insert reddens the four "stays disabled" tests.

Merge order: `Physics2dEnabled` has no writer on `main` — the
`toggle_physics_2d` command that owns it arrives with #9276. This should land
*after* that PR, or 2D physics is un-enableable in between.
