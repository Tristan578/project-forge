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

Starting a second build while one is still finishing no longer leaves the
editor in a state only a page reload recovers from. Cancel now reliably stops
the build that is actually running, rather than sometimes reporting a
cancellation while the work continued. An approval prompt belonging to a build
that has already been superseded no longer replaces the prompt for the live
one, so approving does what the panel says it will. And resetting while a
build is paused for approval now unwinds that build instead of leaving it
parked for the rest of the session, holding on to the tokens it had reserved.

Build-panel text and icons are readable in every theme. Several labels sat
below the contrast floor in at least one theme — worst case just over 4:1 in
Mech and just over 4:1 again on the elevated surface in Rust and Ice — and the
callout borders were faint enough to disappear entirely against their own
tinted interiors. Step-state icons had no text alternative at all, so a screen
reader announced nothing about whether a step had completed, failed or been
skipped, and "skipped" was told apart from "pending" by colour alone; the two
now use distinct glyphs as well.

Editor panels follow the active theme while they load. The panel shell and its
loading skeleton were painted with fixed colours that ignored the theme
entirely — in the light theme the skeleton rendered as black text on an
identical black background, so a panel caught mid-load looked like an empty
void rather than something loading.
