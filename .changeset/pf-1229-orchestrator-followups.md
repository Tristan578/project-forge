---
"web": patch
---

The build panel now shows the whole story when a step is skipped or a build
finishes with warnings, instead of silently dropping that information. A step
the runner skipped (because an earlier step made it unnecessary) now renders
its skip reason next to it rather than looking identical to a step that never
ran; and warnings attached to the plan as a whole now render alongside the
per-step ones instead of being invisible.

The remediation copy that walks someone through fixing a stuck level by hand
now matches what is actually on their screen. A 2D project's Inspector calls
the immovable body option "Static" and the bounce field "Bounciness"; a 3D
project's calls them "Fixed" and "Restitution" — the copy previously always
said the 3D names, so a 2D reader following it was sent looking for an option
that was not on their screen. It now names the label that matches the project
type when the copy is written at the moment of the failure, and names both
spellings where the message is fixed at build time and cannot know which
project it will end up describing.
