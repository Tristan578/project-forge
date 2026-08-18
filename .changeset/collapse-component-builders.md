---
"web": patch
---

Stop the pre-play winnability check from passing a scene whose win condition type it does not recognize. Such a scene reported as winnable and started, but the engine treats an unparseable type as "reach a score" with a target that never accrues, so the game could not actually be won. The check now blocks Play and names the offending value.
