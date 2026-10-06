---
"web": patch
"@project-forge/mcp-server": patch
---

Runtime input replay now runs on a pinned simulation clock, can be paused, resumed and cancelled, and is available to the in-app AI.

When you replay recorded input in the Playtest panel, the engine's clock is pinned for the duration of the replay: every rendered frame advances the game by exactly one tick (60 per second by default), so the same recording produces the same result whether the editor is running at 15 or 144 frames per second. The clock is released again when the replay finishes, is cancelled, or fails. If the engine cannot pin its clock the replay refuses to run instead of reporting a result that could not be trusted, and the result shows whether the clock was pinned.

The Replay button now shows a progress line while a replay runs, with Pause, Resume and Cancel. Pausing releases every key the replay was holding and pauses the game at that tick; resuming picks up the recording where it stopped; cancelling releases the keys, leaves the game running, and records no verdict. Leaving Play mode during a replay cancels it.

The AI gameplay bot can now play the running game instead of only rating it: with Play active and the player entity selected, Run Playtest also turns the bot's plan into a recording and replays it through the engine, showing a runtime verdict next to the heuristic report. The chat assistant has a new `replay_input_trace` tool that does the same thing from a recorded trace or a bot strategy; it is refused outside Play mode with the same rule the panel applies. Two engine commands, `pin_frame_rate` and `unpin_frame_rate`, expose the clock pin to agents.

The record/replay check against the real engine (`e2e/engine/inputReplay.spec.ts`) is now part of the required per-PR engine gate, including a pause, cancel and restart scenario that must land within 0.01 world units of an uninterrupted run.
