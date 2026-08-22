---
"web": patch
---

Physics enablement in the generation pipeline now covers every shape it claims
to.

The feel pass (`physics_profile`) tunes friction, restitution and mass on
entities that a `physics_enable` step has already given a body to. It read only
the first such step, so anything enabled later — the ground, platforms and walls
planned by the world system — kept a body but never received a profile. It now
reads every one.

The ground the auto-polish repair drops in is now sized the way the world
builder sizes it, rather than at a default scale that left a visible seam
between a repaired floor and an authored one.

The shape catalogue the pipeline spawns from is now shared with the world
builder instead of being restated, so the two can no longer disagree about what
is spawnable, and a role whose name collides with a built-in object property no
longer reads a shape off the prototype chain.

Entity ids are validated the way the engine counts them — raw, in bytes, against
the full control-character set — so an id the engine would refuse is refused
here, loudly, instead of being dispatched into silence.
