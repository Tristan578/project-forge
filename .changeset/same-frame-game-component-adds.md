---
"web": patch
---

Adding two game components to the same entity in one engine frame now keeps both. The engine inserted a missing component set through deferred commands, so the second add in the same frame still saw none, built a fresh set holding only itself, and that second insert replaced the first: a player given a Character Controller and Health in one step (as the in-app AI's compound tools do) kept only Health, and a collect-all or reach-goal scene then failed its pre-play check with no player. Pending inserts are now staged per entity and applied once, and the change event for each add lists the accumulated set.
