---
"web": patch
---

The generation pipeline's feel pass now runs where it can see the entities it
profiles, and a step that fails explains itself.

Reading every `physics_enable` step is worthless if the feel pass runs first.
The planner now orders `physics_profile` after every enable step, so the ground,
platforms and walls the world system enables actually receive gravity scale,
friction and restitution rather than being profiled against a set that is still
empty when the pass runs.

Moving the pass also puts it after the player is rigged, so it now re-tunes the
player's character controller — the same speed, jump height and gravity the rig
step chose, merged onto the existing controller so nothing else about it is
lost.

A failed pipeline step showed as a red icon and nothing else: the message
explaining what went wrong was recorded and never rendered. The orchestrator
panel now shows it and announces it to assistive tech.

That message is also followable now. It names the controls as they are labelled
on screen, and it names the Body Type each kind of entity needs — the previous
wording would have turned the floor into a falling body, and pointed at a re-run
that discards the fix it had just asked for.

Step outputs handed to a later step are limited to steps that completed. A
failed step keeps its diagnostic output on purpose, so a step having output was
never evidence that it worked.
