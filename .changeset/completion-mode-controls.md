---
"web": minor
"@spawnforge/ui": minor
"@project-forge/mcp-server": minor
"@spawnforge/docs": patch
---

Choose how a game counts as complete: Win, Endless, Sandbox or Narrative. Set it from the new Completion mode picker in Scene Settings (keyboard-accessible, with its own Undo and Redo), ask the in-app AI (`set_completion_mode`), or describe a sandbox, endless or story game when generating one. Only Win requires a win condition before Play and generated-game verification pass. A win condition the scene does have is still checked in every mode. Generated games no longer get an invented goal when their brief is Endless, Sandbox or Narrative.

The mode is saved with the scene: `.forge` download, auto-save, cloud save, scene switching and checkpoints all carry it, and reopening restores it. Scenes saved before this change have no mode and still open as Win, with the same Play check as before.

Completion-mode controls follow the active theme and use shared native radio controls with full-option touch targets. AI undo/redo can target completion-mode history explicitly.
