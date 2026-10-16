---
"web": patch
---

Scripts and the replay bus receive every play frame in the editor again. The engine sends each Play frame as a `PLAY_TICK_DELTA` event (the entities that changed since the last frame, the ones that were removed, and the input state), but the editor's event hub only knew the full-frame `PLAY_TICK`, so every frame was logged as `Unknown engine event: PLAY_TICK_DELTA` and dropped: a script's `onUpdate` never ran in the editor, `forge.input` never saw a key, and record/replay never observed a frame. The hub now rebuilds the full frame from the deltas (the first frame after entering Play is complete; later frames merge the changed entities, apply the removals, and keep everything else) and hands it on in the shape the script runner and the replay bus already expected. The rebuilt frame is forgotten whenever the engine leaves Play, so an entity from a previous run cannot appear in the next one.
