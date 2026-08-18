---
'web': patch
---

Cutscene playback now reaches something, and every track fires once. Dialogue starts through the dialogue store instead of dispatching `start_dialogue`, an engine command no arm has ever handled. A keyframe's `duration` bounds its beat rather than making it re-dispatch on every frame — that restarted audio and animations continuously, and on the camera track it zeroed the shake state and threw away the accumulated orbital angle and first-person look direction every tick. A keyframe payload is picked field-by-field against a per-track-type allowlist instead of being spread through whole, so nothing the generator invented reaches an engine command; audio's `volume` and `pitch` are bounded to the ranges the audio graph can produce, ahead of the entity-audio wiring that will consume them.

A sink that throws now loses only its own beat instead of every later beat in the same tick, and reports to Sentry rather than only the console. Three playback transitions that each worked alone but broke in combination are fixed: seeking a stopped player and then pressing play no longer burst-fires every beat before the seek point, seeking while paused no longer charges the seek for however long the player sat paused, and pausing a player that never played no longer strands it at "playing" with nothing running and no completion.

Ids named after `Object.prototype` members (`__proto__`, `constructor`, `toString`, and friends) are rejected across every reachable cutscene and dialogue surface — the chat handlers, both stores, the script runner, and the tree editor — rather than resolving to the prototype and either throwing mid-scene or handing back an object that passes an existence check.
