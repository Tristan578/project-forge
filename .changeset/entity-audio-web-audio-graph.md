---
"spawnforge-web": patch
---

Play audio per entity instead of per scene. The editor kept a single audio component for the whole scene — whichever entity reported last — so a scene with two sound sources showed and edited the wrong one, and nothing ever reached the Web Audio graph. Audio is now stored per entity, imported sounds are decoded and attached to the entity that owns them, and a pitch set before a sound plays (or set and then replayed) is no longer discarded.
