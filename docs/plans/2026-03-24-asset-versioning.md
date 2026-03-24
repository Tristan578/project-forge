# Spec: Asset Versioning and History

> **Status:** DRAFT
> **Date:** 2026-03-24
> **Ticket:** PF-372
> **Scope:** Track asset revisions, enable rollback, surface version history in UI

## Problem

When users iteratively refine assets (re-generating textures, re-importing updated models, tweaking shaders), there is no way to compare previous versions or roll back. A bad regeneration permanently replaces the original. This is especially painful for AI-generated assets where each generation costs tokens.

## Solution

Add a **version ledger** per asset that records each mutation as an immutable entry. The ledger lives in the `.forge` scene file (portable, no external DB). The UI shows a timeline per asset; clicking a past version restores it.

### Phase 1 -- Data Model and Engine (low-risk, no UI)

**Rust Changes (`engine/src/core/`)**

1. `asset_manager.rs` -- Add `AssetVersion` struct and `AssetVersionHistory` resource:
   ```
   AssetVersion { version: u32, timestamp: String, source: AssetSource, checksum: String, label: Option<String> }
   AssetVersionHistory { history: HashMap<String, Vec<AssetVersion>> }  // asset_id -> versions
   ```
2. `scene_file.rs` -- Add `asset_versions: HashMap<String, Vec<AssetVersion>>` to `SceneFile` (serde default for backward compat).
3. `core/commands/scene.rs` -- On `import_gltf` / `load_texture` / generated-asset placement, push a new `AssetVersion` entry.
4. `core/pending/scene.rs` -- Add `RevertAssetRequest { asset_id, version }` to the pending queue.

**Bridge Changes (`engine/src/bridge/`)**

5. `scene_io.rs` -- Serialize/deserialize `asset_versions` during save/load.
6. `events.rs` -- Add `emit_asset_version_changed(asset_id, versions)`.

### Phase 2 -- Web Layer (UI + MCP)

7. `web/src/stores/slices/assetSlice.ts` -- Add `assetVersions` map, `revertAsset(assetId, version)` action.
8. `web/src/hooks/events/assetEvents.ts` -- Handle `asset_version_changed` event.
9. `web/src/components/editor/AssetVersionPanel.tsx` -- Timeline list per selected asset, revert button, version labels.
10. `mcp-server/manifest/commands.json` -- Add `list_asset_versions`, `revert_asset_version`, `label_asset_version` commands.
11. `web/src/lib/chat/handlers/assetHandlers.ts` -- Wire the three new MCP commands.

### Phase 3 -- Diffing and Cleanup

12. Texture diff: side-by-side thumbnail comparison using canvas 2D overlay.
13. Storage budget: configurable max versions per asset (default 10), oldest auto-pruned on save.
14. Undo integration: `UndoableAction::AssetRevert` variant for rollback safety.

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Store versions in `.forge` file | Portable -- no server needed for local projects |
| Checksum via SHA-256 of base64 payload | Dedup identical re-imports without storing duplicate blobs |
| Max 10 versions default | `.forge` file stays under 50 MB for texture-heavy scenes |
| No binary diffing | Complexity too high for Phase 1; full snapshots are simpler |

## Constraints

- `.forge` file size grows linearly with version count. Phase 3 pruning mitigates this.
- Textures are stored as base64 data URLs -- 10 versions of a 2 MB texture = 20 MB overhead.
- Checksum computation must stay under 50ms per asset (use SubtleCrypto on JS side).
- Backward compatible: old `.forge` files missing `asset_versions` default to empty.

## Acceptance Criteria

- Given a scene with an imported texture, When the user re-imports a new texture for the same slot, Then the previous version is preserved in the version history.
- Given an asset with 3 versions, When the user reverts to version 1, Then the asset visually matches the original import and a new version 4 entry is created.
- Given an asset with 11 versions, When the scene is saved, Then only the 10 most recent versions are retained.
- Given an AI-generated asset, When generation completes, Then the generation prompt and provider are recorded in the version's `source` field.

## Phase 1 Subtasks

1. Add `AssetVersion` struct and `AssetVersionHistory` resource to `asset_manager.rs`
2. Add `asset_versions` field to `SceneFile` with serde default
3. Wire version creation into `import_gltf` and `load_texture` command handlers
4. Add `RevertAssetRequest` to pending queue and bridge apply system
5. Add `emit_asset_version_changed` event function
6. Add `list_asset_versions` / `revert_asset_version` / `label_asset_version` MCP commands
7. Unit tests: version creation on import, revert behavior, max-version pruning
