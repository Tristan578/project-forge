---
"web": minor
---

Add a pre-play winnability gate. Before entering Play — from both the Play button and the AI `play` tool — the scene is validated to confirm it is actually winnable (a reachable goal with a player, a non-empty collectible set with a win rule, or a positive score target). When it isn't, the AI receives a specific, actionable reason as a tool result and the user sees the same guidance as a chat notice, so an unwinnable generated game is fixed instead of silently entered.
