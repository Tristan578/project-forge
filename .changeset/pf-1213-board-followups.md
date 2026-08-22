---
"web": patch
---

Physics enablement in the generation pipeline now covers every step and every
shape it claims to.

A plan that enables physics in more than one step only ever had its first step
folded into the profile pass, so entities enabled later were profiled against an
empty set and left without a body. The ground the auto-polish repair drops in is
now sized the way the world builder sizes it, rather than at a default scale
that left a visible seam between a repaired floor and an authored one.

The shape catalogue the pipeline spawns from is now shared with the world
builder instead of being restated, so the two can no longer disagree about what
is spawnable, and a role whose name collides with a built-in object property no
longer reads a shape off the prototype chain.

Entity ids are validated the way the engine counts them — raw, in bytes, against
the full control-character set — so an id the engine would refuse is refused
here, loudly, instead of being dispatched into silence. Physics enable and
profile failures now say which entities were affected and what to do next.
