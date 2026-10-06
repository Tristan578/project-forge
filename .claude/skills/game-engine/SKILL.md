---
name: game-engine
description: Web game engine patterns — game loops, physics, collision, sprites, tilemaps, audio, 2D/3D rendering, WebGL, Canvas. Use when implementing game mechanics, SpawnForge engine features, or game system architecture (platformers, physics, input, camera).
---

# Game Engine Skill

SpawnForge's engine is Bevy (Rust → WASM) driven by JSON commands through `handle_command()`; game systems are built as ECS components plus commands, not on a JS game framework.

## SpawnForge-Specific Scripts

- `bash "${CLAUDE_SKILL_DIR}/scripts/check-engine-binaries.sh"` — Verify all 4 WASM engine binaries exist in `web/public/engine-pkg-*`, check file sizes, and report staleness

## SpawnForge-Specific References

- See [ecs-patterns.md](references/ecs-patterns.md) for the complete new-component checklist, entity lifecycle, and command dispatch chain
- See [command-dispatch.md](references/command-dispatch.md) for how the JSON command system works and how to add new commands
- See [templates/component-checklist.md](templates/component-checklist.md) for a fillable checklist to track new component implementation progress
