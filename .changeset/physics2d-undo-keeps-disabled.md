---
"web": patch
---

Stop undo from switching 2D physics on for a body the user disabled.

`UndoableAction::Physics2dChange` records a change to `Physics2dData` and nothing
else — enablement lives in the separate `Physics2dEnabled` marker, which only
`toggle_physics_2d` writes. Both the undo and the redo arm inserted that marker
alongside the restored data, so undoing *any* 2D property edit (friction,
restitution, mass, …) started simulating an entity that had been deliberately
switched off. The 3D `PhysicsChange` arm has always got this right: it mutates
the data in place and never touches `PhysicsEnabled`.

Nothing surfaced it. The inspector reads the data, not the marker, so the panel
looked correct while the body began falling; and because the marker is what the
lifecycle systems key on, the recovery is not another undo — the user has to
find and un-toggle a switch they never touched.

Both arms now restore the data only. The `None` branch still clears the marker
with the data, because an enabled marker with no `Physics2dData` is a state no
command can produce (`apply_physics2d_toggles` inserts default data whenever it
inserts the marker), and that asymmetry is now written down where the arms are.
Four native regression tests pin the disabled case, the redo mirror, the
enabled-body case in the opposite direction, and the `None` branch; the first two
were each measured failing against the pre-fix arm on its own.
