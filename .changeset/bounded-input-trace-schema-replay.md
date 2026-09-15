---
"web": minor
---

Add an experimental input-trace recorder and replay runner, capped at 120 ticks
and 30 seconds, with manual controls in the Playtest panel. The runner reports
observed movement and collectible disappearance separately from the heuristic
AI Playtest rating. Live-engine verification and AI command registration remain
tracked by #10007; the shared runner's unit tests do not establish either.
