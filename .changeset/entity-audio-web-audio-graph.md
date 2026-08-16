---
"web": patch
---

Play audio per entity instead of per scene. The editor kept a single audio component for the whole scene — whichever entity reported last — so a scene with two sound sources showed and edited the wrong one, the AI answered questions about the wrong entity, and nothing ever reached the Web Audio graph. Audio is now stored per entity, imported sounds are decoded and attached to the entity that owns them, and a pitch set before a sound plays (or set and then replayed) is no longer discarded. Sound generation that comes back without a clip now says so instead of attaching a sound that will never play, and deleting an audio asset no longer leaves entities pointing at it silent. Opening a scene restores every entity's audio at once rather than revealing it one selection at a time, and the AI generate buttons now state which tier they need somewhere a screen reader can reach.
