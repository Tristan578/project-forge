---
'web': patch
---

Cutscene playback now reaches something, and every track fires once. Dialogue starts through the dialogue store instead of dispatching `start_dialogue`, an engine command no arm has ever handled. A keyframe's `duration` bounds its beat rather than making it re-dispatch on every frame — that restarted audio and animations continuously, and on the camera track it zeroed the shake state and threw away the accumulated orbital angle and first-person look direction every tick. A sink that throws no longer takes down the rest of the timeline, and scrubbing exactly onto a beat no longer skips it. Audio keyframe volume and pitch are bounded to the ranges the audio graph can actually produce. Dialogue tree ids named after `Object.prototype` members (`__proto__`, `constructor`, and friends) are now rejected instead of resolving to the prototype and throwing mid-scene.
