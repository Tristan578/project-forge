# Spec: Real-Time Collaboration Layer

> **Status:** DRAFT
> **Date:** 2026-03-24
> **Ticket:** PF-373
> **Scope:** Multi-user concurrent editing of the same scene via CRDT-based sync

## Problem

SpawnForge is single-user only. Teams cannot co-edit a scene -- one person works while others wait. Phase 24 (Editor Collaboration) was previously removed because the stub had no real networking backend. This spec designs the system from scratch.

## Solution

A **CRDT-based sync layer** using Yjs as the conflict-free data structure, with a lightweight relay server (Cloudflare Durable Objects or a standalone WebSocket server). Each client maintains a local Yjs document that mirrors the `SceneFile` structure. Mutations are expressed as Yjs operations, broadcast to peers, and applied locally via the existing command pipeline.

### Architecture Overview

```
Client A                        Relay Server                     Client B
--------                        ------------                     --------
Yjs Doc  <-- ws -->  Durable Object / WS Hub  <-- ws -->  Yjs Doc
   |                                                          |
Command Pipeline                                        Command Pipeline
   |                                                          |
Bevy ECS                                                 Bevy ECS
```

The relay is stateless except for transient room state -- no database needed. Persistence is the `.forge` file saved to R2 by any connected client.

### Phase 1 -- Protocol and Awareness (no engine changes)

1. **`web/src/lib/collab/YjsSceneDoc.ts`** -- Yjs `Y.Doc` with typed maps mirroring `SceneFile` top-level keys (`entities`, `environment`, `metadata`, `assets`). Each entity is a `Y.Map` keyed by `entityId`.
2. **`web/src/lib/collab/CollabProvider.ts`** -- WebSocket provider connecting to relay. Handles connect/disconnect/reconnect with exponential backoff.
3. **`web/src/lib/collab/AwarenessState.ts`** -- Yjs awareness protocol: cursor position, selected entity IDs, user name/color. Renders as colored outlines on peer-selected entities.
4. **`web/src/stores/slices/collabSlice.ts`** -- Zustand slice: `peers`, `connectionStatus`, `collabEnabled`, `roomId`.
5. **`web/src/hooks/useCollabSync.ts`** -- Bidirectional sync hook: local command dispatches write to Yjs doc; remote Yjs changes dispatch commands to local engine.
6. **Relay server** -- Minimal Cloudflare Durable Object (or Node WS). Broadcasts Yjs update messages. Room lifecycle: create on first join, destroy after last leave + 5 min grace.

### Phase 2 -- Conflict Resolution and Undo

7. **Entity-level locking** -- Soft locks: when a user selects an entity, awareness broadcasts the lock. Other users see a "locked by X" badge but CAN override (optimistic). Yjs merges handle conflicts.
8. **Undo isolation** -- Each user has their own undo stack (existing `HistoryStack`). Remote changes are NOT added to local undo. `UndoableAction` entries include `originUserId` to filter.
9. **Scene graph conflicts** -- Reparent operations use Yjs `Y.Array` move semantics. Concurrent reparents to different parents resolve via Yjs CRDT rules (last-writer-wins per key).

### Phase 3 -- Presence UI and Polish

10. **Cursor overlay** -- Render peer cursors on the 3D canvas via Bevy gizmo lines (screen-space projected from awareness state).
11. **CollabPanel.tsx** -- Shows connected peers, connection quality, "go to peer's view" button.
12. **MCP commands** -- `start_collab_session`, `invite_to_session`, `list_session_peers`, `leave_session`.
13. **Permission model** -- Room creator is owner. Invite links with read-only or edit capability. Ties into Clerk user identity.

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Yjs over custom OT | Battle-tested CRDT library, handles offline/reconnect, tiny bundle (~15 KB) |
| Entity-per-Y.Map | Natural conflict granularity -- two users editing different entities never conflict |
| Relay, not P2P | NAT traversal is unreliable in browsers; relay is simpler and works with firewalls |
| Cloudflare Durable Objects | Already have Cloudflare account; sub-ms latency in same region; auto-scales |
| Soft locks, not hard | Hard locks cause deadlocks when users disconnect; soft locks are advisory |

## Constraints

- **Bandwidth:** Yjs updates are compact (~100 bytes per property change), but scenes with 1000+ entities produce large initial sync payloads. Use Yjs encoding (binary) not JSON.
- **Latency:** Target < 100ms round-trip for property changes (relay in same region).
- **Max peers:** 8 concurrent editors per room (Durable Object memory limit).
- **No engine changes in Phase 1:** All sync happens at the command/store layer. The Bevy engine remains single-user.
- **Offline:** Yjs handles offline edits natively. On reconnect, pending updates merge automatically.

## Acceptance Criteria

- Given two users in the same room, When user A moves an entity, Then user B sees the entity move within 200ms.
- Given user A has entity X selected, When user B views the scene, Then entity X shows a colored outline indicating A's selection.
- Given user A is offline for 30 seconds, When A reconnects, Then A's offline edits merge with B's changes without data loss.
- Given a room with no users for 5 minutes, When the grace period expires, Then the relay destroys the room and frees resources.

## Phase 1 Subtasks

1. Set up Yjs dependency (`yjs`, `y-websocket`) in `web/package.json`
2. Create `YjsSceneDoc.ts` with typed Y.Map structure mirroring SceneFile
3. Create `CollabProvider.ts` WebSocket provider with reconnect logic
4. Create `AwarenessState.ts` for peer cursor/selection broadcasting
5. Create `collabSlice.ts` Zustand slice for connection state and peer list
6. Create `useCollabSync.ts` hook bridging Yjs changes to dispatchCommand
7. Deploy minimal Cloudflare Durable Object relay (or Node WS prototype)
8. Unit tests: Yjs doc structure, awareness state, sync round-trip
