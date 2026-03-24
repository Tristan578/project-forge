# Spec: Game-to-Game Portal System

> **Status:** DRAFT — Awaiting Approval
> **Date:** 2026-03-24
> **Ticket:** PF-584
> **Scope:** Published games can link to each other via in-game portals

## Problem

SpawnForge games are isolated islands. There is no way for a player in one game to seamlessly transition to another published game. Creators cannot build interconnected worlds, game hubs, or cross-promotional experiences. This limits both creator collaboration and player retention on the platform.

## Solution

Add a **Portal** system: a script API and optional game component that navigates the player from one published game to another, with optional data handoff. Portals are lightweight -- they are a URL redirect with metadata, not a networking feature.

### How It Works

1. Creator places a portal entity (or calls `forge.portal.open()` from script).
2. Portal specifies a target game by **slug** (the same slug used in cloud publishing).
3. On trigger, the runtime shows a brief interstitial ("Traveling to Game Name..."), then navigates the browser to `/play/<slug>?from=<source-slug>&data=<base64>`.
4. The target game's runtime reads `from` and `data` query params via `forge.portal.getArrivalData()`.

### Game Component: Portal

Added to the existing 12 game components in `engine/src/core/game_components.rs`:

```rust
Portal {
    target_slug: String,
    label: String,           // Display text, e.g. "Enter the Dungeon"
    transition: String,      // "fade" | "wipe" | "instant"
    data: Option<String>,    // JSON string passed to target game
    auto_trigger: bool,      // Trigger on collision vs. manual script call
}
```

This is a **GameComponent variant**, not a new ECS component. It reuses the existing `GameComponentData` system. When `auto_trigger` is true, the `system_portal` play-mode system checks collision events and triggers navigation.

### Script API (`forge.portal.*`)

```typescript
namespace forge.portal {
  /** Navigate to another published game */
  function open(slug: string, options?: {
    data?: object;           // Passed as base64 query param
    transition?: 'fade' | 'wipe' | 'instant';
    label?: string;          // Shown in interstitial
  }): void;

  /** Get data passed from the source game (null if direct navigation) */
  function getArrivalData(): { fromSlug: string; data: object } | null;
}
```

### Rust Changes (engine/)

- Add `Portal` variant to `GameComponentType` enum in `core/game_components.rs`.
- Add `system_portal` to bridge/game.rs: on collision with portal entity in play mode, emit `PORTAL_TRIGGERED` event with slug + data.
- Gate behind `#[cfg(not(feature = "runtime"))]` for editor preview; runtime build includes the real trigger.

### Web Changes (web/src/)

- **Play page** (`/play/[slug]`): Parse `from` and `data` query params, inject into script worker globals.
- **Script worker bridge**: Implement `forge.portal.open()` as a `postMessage` to main thread, which does `window.location.href` redirect.
- **Interstitial overlay**: Simple CSS fade overlay with game title, shown for 1s before redirect.
- **GameComponentInspector**: Add Portal fields (target slug input with validation, label, transition picker, auto-trigger toggle).
- **PortalPreview**: In edit mode, render a Gizmo marker (translucent rectangle) so creators can see portal placement.

### MCP Commands (3 new)

| Command | Category | Description |
|---------|----------|-------------|
| `add_portal` | game | Add portal component to entity with target slug, label, transition |
| `set_portal_target` | game | Change portal's target slug and data |
| `list_portal_links` | game | List all portal entities in current scene |

## Constraints

- **Target game must be published.** Portal to unpublished slug shows "Game not found" to the player.
- **Data payload max 4KB** (base64 in URL). For larger transfers, use `forge.universe` (PF-583).
- **No backward navigation.** Portal is one-way. The target game can portal back if it chooses.
- **No engine networking.** This is a browser navigation, not a live connection.
- **Works in both render backends.** Portal is a game component + script API, not a rendering feature.
- **Works in exported games.** Exported standalone games can portal to published SpawnForge URLs. Self-hosted games cannot portal (no `/play/` route).

## Acceptance Criteria

- Given an entity with a Portal component targeting slug "dungeon", When the player collides with it in play mode, Then the browser navigates to `/play/dungeon` with the portal data.
- Given a script calls `forge.portal.open("dungeon", { data: { level: 5 } })`, When the target game loads, Then `forge.portal.getArrivalData()` returns `{ fromSlug: "source-slug", data: { level: 5 } }`.
- Given a portal targets a slug that does not exist, When the player triggers it, Then the interstitial shows "Game not found" and returns to the source game after 3 seconds.
- Given an entity with Portal in edit mode, When selected, Then the inspector shows slug input, label, transition, and auto-trigger fields.

## Alternatives Considered

- **iframe embedding:** Rejected -- WASM memory limits, no cross-origin isolation, double engine load.
- **Scene import from another project:** Rejected -- requires asset deduplication, permission system, and scene format versioning that does not exist yet.
- **WebRTC tunneling:** Rejected -- Phase 25 (Multiplayer) is removed. Portals are intentionally stateless.
