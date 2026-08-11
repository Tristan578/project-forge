---
"web": patch
---

Cutscene camera moves now actually move. A camera keyframe with a duration and
an easing curve snapped to its destination on its first frame — the eased
progress was written onto the command as a field no engine command reads — so
every authored camera move was a cut.

Every other kind of keyframe was being re-sent on every animation frame for the
length of its duration, which restarted the sound, the animation clip and the
dialogue about sixty times a second. Those now fire once. An audio keyframe also
stops sending volume and fade settings that the engine discards, and a dialogue
keyframe that names no dialogue tree is no longer sent at all.

Reconfiguring a game camera mid-play no longer cancels a camera shake that is
still running, or snaps a first-person or orbital camera back to its starting
angle.
