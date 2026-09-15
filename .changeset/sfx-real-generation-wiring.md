---
"web": patch
---

Stop game-creation asset steps from reporting completion without a delivered asset. Asset generation now reports that it is unavailable, stops required steps, and skips optional steps with an explanation. Suggested fallback identifiers are not presented as attached assets.

The pipeline does not call a separate paid sound-generation route while artifact delivery and reservation-aware billing are incomplete. This does not add playable audio generation to game creation; that integration remains pending.
