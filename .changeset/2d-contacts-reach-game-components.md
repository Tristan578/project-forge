---
"web": patch
---

In 2D projects the built-in Collectible, Damage Zone, Checkpoint, Teleporter, Trigger Zone and reach-goal Win Condition components now react when the player touches them. The engine's collision tracker only read contacts from the 3D simulation, so a 2D game's contacts never reached those components and every one of them needed a hand-written collision script. The tracker now merges the 2D simulation's contacts into the same per-frame set; 3D behaviour is unchanged.
