---
"spawnforge-web": patch
---

Game-creation pipeline steps now report engine rejections instead of silently
claiming success. Camera setup, 2D character rigs, custom scripts and physics
profiles route their engine commands through the shared batch dispatcher, and a
refused command fails the step that sent it rather than showing a green tick.
