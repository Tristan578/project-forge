---
name: multiplayer-readiness
description: Use when modifying entity state management, physics, scene serialization, input handling, or scripting sandbox. Flags architectural decisions that would make future multiplayer harder. Trigger on "multiplayer", "networking", "state sync", "entity authority", "determinism", or when touching core ECS state flow.
---

<!-- pattern: Reviewer -->

# Multiplayer Readiness Audit

SpawnForge Phases 24 (Editor Collaboration) and 25 (Multiplayer Networking) were REMOVED -- no networking backend exists. Multiplayer WILL be rebuilt from scratch at Stage 4 (18mo+, 100k+ users). See PRD Theme 5: Platform Distribution.

**This skill is NOT for building multiplayer.** It is a lightweight reviewer that flags code changes which would make future multiplayer significantly harder to implement. Load `references/multiplayer-checklist.md` and score changes against it.

## When to Use

Invoke this skill when modifying any of these areas:
- Entity state management (`engine/src/core/pending/`, `entity_factory.rs`, `history.rs`)
- Physics configuration (`PhysicsData`, `RapierConfiguration`, forces, collisions)
- Scene serialization (`scene_file.rs`, `snapshot_scene`, `.forge` format)
- Input handling (`InputMap`, `InputState`, `capture_input`)
- Scripting sandbox (`scriptWorker.ts`, `forge.*` API)
- Game runtime systems (`engine_mode.rs`, `PlaySystemSet`)

## Process

1. Read @.claude/skills/multiplayer-readiness/references/multiplayer-checklist.md for the full rubric
2. Identify which checklist categories are affected by the current changes
3. Score only the relevant categories (skip unaffected ones)
4. Report findings as: OK (no concern), CAUTION (adds complexity for multiplayer but acceptable), or FLAG (creates a hard blocker that should be reconsidered)

## Key Principles

The goal is NOT to build multiplayer-ready code now. The goal is to avoid decisions that create expensive rework later. Specifically:

- **State must be serializable** -- any entity state that can't round-trip through JSON/binary will need custom sync code later
- **Physics must be separable** -- physics stepping must be callable independently of rendering so a server can run it headlessly
- **Input must be abstractable** -- input must flow through a layer that can later be swapped for network input
- **Time must be controllable** -- game logic should use a delta-time parameter, not wall-clock time
- **Authority must be possible** -- entity mutations should flow through a chokepoint (handle_command) that can later be authority-checked
