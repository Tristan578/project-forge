---
"web": patch
---

Reject a generated game design that declares a movement system but casts no player entity. The two fields were each valid in isolation, so the nonsense design survived decomposition and only surfaced downstream as a dropped character-setup step — the user asked for movement and got a game where nothing moves. The decomposer now fails that GDD and re-prompts the model instead.
