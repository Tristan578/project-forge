---
"web": minor
---

Add a bounded input-trace record/replay for playtesting. You can now record the
inputs you make while playing a game into a typed, size-bounded trace (capped at
120 ticks / 30 seconds) and replay them back through the real engine to verify
the game responds — the player moves and collectibles are collected. Manual
Record/Replay controls live in the Playtest panel, and the in-app AI uses the
exact same replay command with identical validation. This runtime replay is kept
distinct from the existing heuristic AI Playtest rating.
