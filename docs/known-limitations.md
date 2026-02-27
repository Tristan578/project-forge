# Known Limitations

This document provides an honest accounting of features that are partially implemented or UI-only facades. Features listed here have editor UI and MCP command definitions, but limited or no engine integration.

## 2D Subsystem (Phases 2D-1 through 2D-5)

**Status: UI scaffolding only — no Bevy engine integration**

The 2D system includes inspector panels, store slices, and MCP command definitions for:
- Sprites and sprite sheets
- Sprite animation and state machines
- Tilemap editing (multi-layer)
- 2D physics (colliders, joints)
- 2D skeletal animation (bones, skins, IK)

These features render UI in the editor but do not create or modify Bevy ECS components. Commands are dispatched to the engine but the pending queue handlers are stubs. The Rust `bridge/skeleton2d.rs` and sprite-related systems exist but are not fully wired to produce rendered output in the canvas.

**Workaround:** Use the 3D engine for all game creation. 2D games can be approximated using orthographic cameras with 3D primitives.

## Editor Collaboration (Phase 24)

**Status: Local state simulation — no networking**

The collaboration system includes:
- Sync manager with local state tracking
- User avatar display
- Activity feed
- Entity locking UI

All state is local-only. No WebSocket server, no real-time synchronization between users. The sync manager simulates multi-user state for UI purposes only.

## Multiplayer Networking (Phase 25)

**Status: Local state simulation — no networking**

Similar to collaboration, the multiplayer system includes:
- Network client stub
- Spawn point configuration
- `forge.net` script API

No actual networking is implemented. All multiplayer state is local simulation. Calling `forge.net` methods in scripts has no cross-client effect.

## LOD & Performance (Phase 31)

**Status: UI + metrics stubs**

LOD (Level of Detail) includes:
- `LodData` ECS component definition
- LOD Inspector panel
- Performance budget UI

The bridge systems drain the LOD request queues but log "not implemented" instead of generating mesh LODs or collecting real performance statistics.

## Advanced Audio (Phase 20)

**Status: Basic audio works, adaptive features are stubs**

Working:
- Spatial audio playback
- Audio bus routing
- Reverb zones

Stubs (console.log only):
- Adaptive music (horizontal re-sequencing)
- Audio occlusion
- Audio snapshots

## Shader Application (Phase 23)

**Status: Editor and compiler work, application to entities does not**

The shader node graph editor and WGSL compiler are functional — you can create node graphs and compile them to WGSL code. However, compiled shaders cannot be applied to entities at runtime. The "apply shader" pipeline is not connected end-to-end.

## Game Component Runtime (Phase 5-D)

**Status: 7 of 13 components work, 6 are stubs**

Working runtime behaviors: CharacterController, Health, Collectible, Projectile, MovingPlatform, Enemy, Inventory

Stub behaviors (empty runtime systems): DamageZone, Checkpoint, Teleporter, TriggerZone, Spawner, DialogueTrigger

These stub components can be added to entities via the inspector but have no effect during play mode. Their functionality can be replicated using the script API.

## Scene Hierarchy on Load

Parent-child relationships are saved in `.forge` files but are not fully restored when loading a scene. Entities load with correct transforms but may lose their hierarchy (reparenting).
