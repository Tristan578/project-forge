# Spec: Instant Multiplayer — AI-Generated Networking Code

> **Status:** DRAFT — Awaiting Approval
> **Date:** 2026-03-24
> **Ticket:** PF-554
> **Scope:** Enable "add 2-player co-op" as an AI chat command that generates networking code, split-screen camera setup, and player input routing for exported games.

## Problem

SpawnForge users want to add multiplayer to their games but have no networking infrastructure. Phase 25 (Multiplayer Networking) was previously removed because no backend existed. Users currently cannot create any form of multiplayer — not even local split-screen — without writing custom code from scratch.

The goal is not to build a full multiplayer backend. It is to let the AI generate working networking code that ships with exported games, using a pragmatic peer-to-peer approach that avoids dedicated server infrastructure for the MVP.

## Constraints & Non-Goals

- **No dedicated game servers in MVP.** All networking is peer-to-peer via WebRTC DataChannels.
- **No matchmaking service in MVP.** Players share a room code to connect.
- **No authoritative server model in MVP.** Host-authoritative with client prediction.
- **Split-screen is local-only.** It does not require networking.
- **Max 4 players in MVP.** Scales to 8 in Phase 2.
- **Single-threaded WASM.** Networking code runs in a dedicated Web Worker, not in the Bevy frame loop.

## Solution

### Architecture Overview

```
Player A (Host)                          Player B (Client)
┌──────────────┐                        ┌──────────────┐
│ Bevy Runtime  │                        │ Bevy Runtime  │
│ (WASM)       │                        │ (WASM)       │
├──────────────┤                        ├──────────────┤
│ Net Worker   │◄──── WebRTC ──────────►│ Net Worker   │
│ (Web Worker) │    DataChannel          │ (Web Worker) │
├──────────────┤                        ├──────────────┤
│ Signaling    │◄──── WebSocket ───────►│ Signaling    │
│ Client       │    (room join only)     │ Client       │
└──────────────┘                        └──────────────┘
         │                                       │
         └───────── Signaling Server ────────────┘
                  (Vercel Edge Function
                   or Cloudflare Durable Object)
```

### Phase 1: Local Split-Screen (No Networking)

This is the MVP that ships first. It requires zero infrastructure.

#### Engine Changes (Rust)

**New components:**
- `PlayerSlot(u8)` — Marks which player controls an entity (0-3).
- `SplitScreenConfig` — Resource storing layout (horizontal/vertical/quad), active player count.
- `PlayerCamera(u8)` — Marks a camera as belonging to a specific player slot.

**New commands:**
- `set_split_screen { layout: "horizontal" | "vertical" | "quad", players: 2 | 3 | 4 }`
- `assign_player_slot { entityId, slot: 0-3 }`
- `set_player_camera { entityId, slot: 0-3, viewport: { x, y, w, h } }`

**New systems:**
- `update_split_screen_viewports` — Adjusts `Camera.viewport` based on `SplitScreenConfig` changes. Runs in `EditorSystemSet` and `PlaySystemSet`.
- `route_player_input` — Routes `InputState` per-player by checking `PlayerSlot` on controlled entities. Extends existing `capture_input` system.

**Pending queue additions** (`core/pending/game.rs`):
- `SplitScreenRequest`, `PlayerSlotRequest`, `PlayerCameraRequest`

**UndoableAction variants:**
- `SplitScreenChange { before: Option<SplitScreenConfig>, after: Option<SplitScreenConfig> }`
- `PlayerSlotChange { entity_id, before: Option<u8>, after: Option<u8> }`

#### Web Changes

**Store slice:** `splitScreenSlice.ts`
- State: `splitScreenLayout`, `playerCount`, `playerSlots: Record<string, number>`
- Actions: `setSplitScreen()`, `assignPlayerSlot()`, `clearSplitScreen()`

**Event handler:** `hooks/events/splitScreenEvents.ts`
- Handles `split_screen_changed`, `player_slot_changed` events from engine.

**Chat handler:** `chat/handlers/multiplayerHandlers.ts`
- Tool: `add_split_screen` — AI parses "add 2-player co-op" and dispatches `set_split_screen` + creates two cameras + assigns player slots.
- Tool: `assign_player` — Assigns an entity to a player slot.

**Inspector UI:** `SplitScreenInspector.tsx`
- Dropdown for layout selection (horizontal/vertical/quad).
- Player count selector.
- Per-entity "Player Slot" dropdown in the main InspectorPanel.

**MCP commands (4 new):**
- `set_split_screen`, `assign_player_slot`, `set_player_camera`, `query_split_screen`

#### Script API Extensions (`forge.multiplayer`)

```typescript
declare namespace forge.multiplayer {
  /** Get the local player's slot index (0-based) */
  function getLocalPlayer(): number;
  /** Get total number of players */
  function getPlayerCount(): number;
  /** Check if an entity belongs to a specific player */
  function isOwnedBy(entityId: string, playerSlot: number): boolean;
  /** Get all entities owned by a player */
  function getPlayerEntities(playerSlot: number): string[];
}
```

### Phase 2: Peer-to-Peer Networking (WebRTC)

Ships after Phase 1 is validated. Requires signaling infrastructure.

#### Signaling Server

**Option A (Recommended): Cloudflare Durable Objects**
- Stateful WebSocket rooms with zero cold-start.
- Room lifecycle: create on host join, destroy 30s after last player leaves.
- Room code: 6-character alphanumeric (e.g., `FORGE-A3X9`).
- Cost: ~$0.15/million requests + $0.50/million WebSocket messages.

**Option B: Vercel Edge Functions + Upstash Redis**
- WebSocket via Vercel's edge runtime.
- Room state in Upstash Redis with TTL.
- Higher latency than Durable Objects.

**Signaling protocol (minimal):**
```json
// Client -> Server
{ "type": "create_room" }                    // Host creates room
{ "type": "join_room", "code": "A3X9" }     // Client joins
{ "type": "signal", "to": "peer_id", "data": {} }  // ICE/SDP relay

// Server -> Client
{ "type": "room_created", "code": "A3X9" }
{ "type": "peer_joined", "peerId": "...", "slot": 1 }
{ "type": "peer_left", "peerId": "..." }
{ "type": "signal", "from": "peer_id", "data": {} }
```

#### Networking Worker (`web/src/lib/networking/`)

**`netWorker.ts`** — Web Worker that owns all WebRTC connections.
- Creates `RTCPeerConnection` per remote player.
- Uses `RTCDataChannel` (unreliable for position, reliable for events).
- Message types:
  - `state_update` (unreliable, 20Hz): `{ tick, entities: [{ id, pos, rot, vel }] }`
  - `event` (reliable): `{ type: "spawn" | "destroy" | "damage" | "custom", data }`
  - `input` (unreliable, 60Hz): `{ tick, slot, keys, mouse }`

**`netProtocol.ts`** — Binary encoding for state updates.
- Entity ID (4 bytes, mapped integer) + position (12 bytes, f32x3) + rotation (12 bytes) = 28 bytes/entity.
- Delta compression: only send entities that changed since last ack.
- Budget: 1KB/frame at 20Hz = 20KB/s per connection. Max 4 players = 60KB/s total.

**`netHost.ts`** — Host-authoritative logic.
- Receives inputs from clients, applies to local simulation, broadcasts state.
- Client prediction: clients apply their own input immediately, reconcile on host state receipt.

#### Engine Changes for Networked Play

**New component:** `NetworkedEntity { owner: u8, last_sync_tick: u64 }`

**New commands:**
- `start_hosting { maxPlayers: 2-4 }`
- `join_game { roomCode: string }`
- `leave_game {}`
- `set_network_owner { entityId, playerSlot }`

**New systems (runtime-only):**
- `apply_network_state` — Reads state updates from Net Worker, applies to non-local entities.
- `send_local_state` — Serializes local entity state, posts to Net Worker.
- `interpolate_remote_entities` — Smooths remote entity positions between updates.

### Phase 3: AI Code Generation (The "add 2-player co-op" Flow)

This is the AI-facing layer that makes the above invisible to users.

#### Chat Handler: `addMultiplayer`

When user says "add 2-player co-op", the AI:

1. **Analyzes the scene** — Identifies the player entity (by name, `GameComponent`, or `PlayerSlot`).
2. **Generates a networking script** — Creates a `forge.multiplayer` script that:
   - Syncs the player entity's transform at 20Hz.
   - Routes input per player slot.
   - Handles spawn/destroy events.
3. **Sets up split-screen** — Dispatches `set_split_screen` + camera commands.
4. **Attaches the script** — Adds the generated script to the player entity.

The generated script follows a template in `web/src/lib/scripting/templates/multiplayerTemplate.ts`:

```typescript
// Template: 2-player co-op
const localSlot = forge.multiplayer.getLocalPlayer();
const entities = forge.multiplayer.getPlayerEntities(localSlot);

forge.onUpdate((dt) => {
  for (const id of entities) {
    if (forge.multiplayer.isOwnedBy(id, localSlot)) {
      // Apply local input
      const input = forge.input.getState();
      if (input.keys['w']) forge.translate(id, 0, 0, -5 * dt);
      // ... generated based on existing input bindings
    }
  }
});

forge.multiplayer.onPeerJoined((slot) => {
  forge.log(`Player ${slot + 1} joined!`);
});
```

## Data Model Changes

### New DB Tables (Phase 2 only)

```sql
-- Room codes for signaling (ephemeral, not persisted long-term)
-- This lives in the signaling server (Durable Object state or Redis), NOT in Neon.
```

No new Neon tables needed for MVP. Room state is ephemeral in the signaling layer.

### Schema Changes (Phase 1)

**`projects.sceneData` (jsonb)** — The `.forge` scene format gains:
```json
{
  "splitScreen": {
    "layout": "horizontal",
    "players": 2
  },
  "playerSlots": {
    "entity-uuid-1": 0,
    "entity-uuid-2": 1
  }
}
```

No DB migration needed — this is inside the existing `sceneData` jsonb column.

## Security Considerations

1. **Signaling server abuse:** Rate limit room creation (10/min per IP). Room codes expire after 10 minutes of inactivity.
2. **WebRTC data injection:** All `state_update` messages validated against expected entity schema. Malformed messages dropped.
3. **Bandwidth abuse:** Hard cap at 100KB/s per connection. Disconnect peers exceeding limit.
4. **Room enumeration:** 6-char alphanumeric = 2.1 billion codes. Random generation prevents guessing.
5. **No user data in signaling:** Room codes are ephemeral. No PII passes through the signaling server.
6. **TURN server cost:** TURN relay is expensive. MVP uses STUN-only. Phase 2 adds TURN fallback with per-user bandwidth limits tied to subscription tier.

## Performance Budget

| Metric | Budget |
|--------|--------|
| Split-screen overhead | < 2ms per frame (viewport recalculation) |
| Network serialization | < 1ms per frame (20Hz send rate) |
| WebRTC DataChannel latency | < 50ms p95 (same region) |
| Bandwidth per player | < 20KB/s upstream |
| Net Worker memory | < 10MB |
| Room join time | < 3s (STUN), < 5s (TURN) |

## Acceptance Criteria

### Phase 1 (Split-Screen)
- Given a scene with 2 entities, When user says "add 2-player co-op", Then AI sets up horizontal split-screen with two cameras and assigns entities to player slots 0 and 1.
- Given split-screen is active, When in play mode, Then player 1 input (WASD) controls slot-0 entities and player 2 input (arrow keys) controls slot-1 entities.
- Given split-screen is configured, When user exports the game, Then the exported game renders split-screen correctly in the runtime binary.
- Given split-screen was added, When user presses Ctrl+Z, Then split-screen configuration is undone and single camera is restored.

### Phase 2 (Networking)
- Given a hosted game, When a remote player enters the room code, Then WebRTC connection establishes within 5 seconds.
- Given two connected players, When host moves their character, Then client sees the movement within 100ms.
- Given a networked game, When one player disconnects, Then the other player sees a "Player left" message and gameplay continues.
- Given a networked game, When exported, Then the exported game includes the networking worker and signaling client.

### Phase 3 (AI Generation)
- Given a single-player game, When user says "make this 2-player", Then AI generates appropriate networking scripts, split-screen setup, and input routing without manual configuration.

## Alternatives Considered

1. **Server-authoritative with Cloudflare Workers:** Rejected for MVP because it requires dedicated infrastructure and adds latency for physics-heavy games. P2P with host-authority is simpler and free.

2. **WebTransport instead of WebRTC:** Rejected because WebTransport requires a server endpoint. WebRTC DataChannels work peer-to-peer without infrastructure (STUN-only for most NAT types).

3. **Bevy networking crate (bevy_replicon / lightyear):** Rejected because these assume native Rust networking stacks (tokio, quinn). They do not work in WASM without significant porting. Our networking must be JS-side.

4. **Full state replication:** Rejected for bandwidth reasons. Delta compression with interest management (only sync entities near each player) is required for any scene with >50 entities.

## Phased Implementation Plan

| Phase | Scope | Infra Needed | Estimated Effort |
|-------|-------|-------------|-----------------|
| 1: Split-Screen | Local co-op, viewports, input routing, AI command | None | 2-3 weeks |
| 2: P2P Networking | WebRTC worker, signaling, state sync | Signaling server | 4-6 weeks |
| 3: AI Generation | Template scripts, scene analysis, auto-setup | None | 1-2 weeks |
| 4: Polish | Latency compensation, >2 players, reconnection | TURN fallback | 2-3 weeks |
