---
"web": patch
---

Fixed a replay started right after a cancelled one cancelling itself as if the game had been paused from the toolbar. When a replay was cancelled while its own Pause was still queued in the engine, the next frame reported that Pause to whichever replay was watching then, so a replay started straight away, from the chat tool or the replay controls, read it as the creator's toolbar Pause and stopped with "the game was paused from the toolbar". An ended replay now hands the Pauses the engine has not reported yet to the next replay on the same engine, which counts them as that earlier replay's own until its first play tick.
