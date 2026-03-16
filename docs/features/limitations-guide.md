---
title: Known Limitations & Workarounds
description: What SpawnForge can and can't do today, with workarounds for common gaps
lastUpdated: 2026-03-16
relatedFiles:
  - docs/known-limitations.md
---

# Known Limitations & Workarounds

SpawnForge is feature-complete for most game creation workflows. This guide covers the few areas with genuine constraints and how to work around them.

## What's Fully Working

These features are complete, tested, and production-ready:

- **2D Engine**: Sprites, tilemaps, 2D physics (Rapier2D), joints, sprite animation, camera
- **3D Engine**: PBR materials, skeletal animation, physics (Rapier3D), particles, terrain, CSG, LOD
- **AI Creation**: 322 MCP commands, natural language chat, compound actions, asset generation
- **Audio**: Spatial audio, bus mixer, reverb zones, adaptive music, snapshots
- **Scripting**: TypeScript + visual scripting with 73 node types
- **Export**: HTML5 bundles, cloud publishing, mobile touch controls
- **Platform**: Subscriptions, token management, community gallery, in-editor docs

## Current Limitations

### 1. 2D Skeletal Animation — No Visual Weight Editor
**What works**: Bone animation, IK, blend trees, vertex skinning — all functional.
**What's missing**: Creating mesh attachments (vertex weights) requires the MCP command or AI chat. There's no drag-and-drop weight painting UI yet.
**Workaround**: Use the AI chat: "Create a mesh attachment for my character with 4 bones". Or use sprite animation state machines for simpler cases.
**Timeline**: UI panel planned for next quarter.

### 2. Custom Shaders — 8 Slot Limit
**What works**: 7 built-in shader effects (dissolve, hologram, toon, etc.) + 8 custom mega-shader slots with WGSL code.
**What's missing**: Each custom shader is limited to 16 float parameters (no texture samplers). Switching shaders causes a 50-200ms recompile pause.
**Workaround**: Use built-in shaders when possible. For custom effects, keep parameters under 16 and batch shader changes (don't switch every frame).
**Why**: WebGPU pipeline compilation is inherently costly. This is a browser limitation, not a SpawnForge limitation.

### 3. Audio Occlusion — Physics-Based Only
**What works**: Sound occlusion via physics raycasting (graduated distance attenuation with lowpass filter).
**What's missing**: No material-based occlusion (e.g., "wood blocks less than concrete"). All colliders attenuate equally.
**Workaround**: Use reverb zones to simulate different room acoustics. Place multiple zone volumes to create spatial transitions.

### 4. Real-Time Collaboration — Not Yet Available
**What works**: Single-user editing with cloud save.
**What's missing**: Multi-user co-editing, cursor sharing, live presence.
**Workaround**: Share projects via the cloud save system. One user edits at a time.
**Timeline**: Planned as a major feature (Phase 28+). Evaluating Y.js and Liveblocks.

### 5. Mobile Editor — View Only
**What works**: Published games play on mobile with touch controls (5 presets).
**What's missing**: The editor itself is not optimized for mobile screens (no touch-based entity manipulation).
**Workaround**: Use a tablet in landscape mode for light editing. Full editing requires desktop/laptop.

## Performance Targets

| Scenario | Target | Current |
|----------|--------|---------|
| 50+ skinned 2D sprites | 60fps on WASM | Achieved |
| 1000-tile tilemap | <100ms paint latency | Achieved |
| 100+ physics bodies | 60fps with Rapier | Achieved |
| Custom shader switch | <200ms compile | Achieved |
| WASM engine load | <10s on broadband | Achieved (with CDN) |

## What We're NOT Building (And Why)

- **Native mobile app export**: Focus is browser-first. PWA + touch controls cover mobile play. Native stores add review delays and 30% revenue cut.
- **VR/AR support**: WebXR is promising but the ecosystem isn't mature enough for a game creation tool. Revisiting in 2027.
- **MMO networking**: Real-time multiplayer is deferred. The architecture supports it (async channels, entity IDs), but the infrastructure investment is significant.
