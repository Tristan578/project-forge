/**
 * Event handlers for sprites, the 2D camera, and tilemaps.
 *
 * Every arm in this file used to be dead. The three real engine events were
 * listened for under names nothing has ever emitted (`SPRITE_UPDATED` vs the
 * emitted `SPRITE_CHANGED`, `CAMERA2D_UPDATED` vs `CAMERA_2D_CHANGED`,
 * `TILEMAP_UPDATED` vs `TILEMAP_CHANGED`), and six more arms named events with no
 * emitter anywhere in the engine. A `case` for an event that is never emitted is
 * silently dead — the switch just returns `false` and nothing reports it — so the
 * whole 2D surface had no inbound path at all (PF-1170).
 *
 * These names are emitted by NOTHING in `engine/src/bridge/events.rs` and are
 * deliberately absent below rather than left as stubs that lie about being
 * handled. `__tests__/spriteEvents.test.ts` pins each one as unhandled:
 *   SPRITE_SHEET_UPDATED, SPRITE_ANIMATOR_UPDATED, ANIMATION_STATE_MACHINE_UPDATED,
 *   TILEMAP_REMOVED, TILESET_LOADED
 * Sprite sheets, sprite animators, animation state machines and tilesets
 * therefore have no engine→store path at all; that is an engine-side emitter
 * gap, tracked separately from this file. `PROJECT_TYPE_CHANGED` left that
 * list in #10227: `apply_project_type_changes` now emits it for every request
 * it processes, and the arm below is what lets a reopened 2D project come back
 * as 2D without an AI turn.
 */

import { useEditorStore } from '@/stores/editorStore';
import {
  parseSpriteWire,
  parseCamera2dWire,
  parseTilemapWire,
} from '@/lib/sprite/sprite2dPayload';
import { isSceneProjectType } from '@/lib/scenes/sceneProjectType';
import { castPayload, type SetFn, type GetFn } from './types';

export function handleSpriteEvent(
  type: string,
  data: Record<string, unknown>,
  _set: SetFn,
  _get: GetFn
): boolean {
  switch (type) {
    // `{ entityId, sprite: Option<SpriteData> }`. `SpriteData` is the one 2D
    // component without `#[serde(rename_all)]`, so the body inside that camelCase
    // envelope is snake_case — a cast into the store's type yields all-`undefined`
    // fields. `sprite: null` means the entity has no sprite, not an empty one.
    case 'SPRITE_CHANGED': {
      const payload = castPayload<{ entityId: string; sprite: unknown }>(data);
      if (typeof payload.entityId !== 'string') return true;
      const sprite = payload.sprite === null || payload.sprite === undefined
        ? null
        : parseSpriteWire(payload.sprite);
      // A malformed body is dropped rather than written: overwriting a real sprite
      // with a default one is the destructive direction.
      if (sprite === null && payload.sprite !== null && payload.sprite !== undefined) {
        return true;
      }
      useEditorStore.getState().applySpriteFromEngine(payload.entityId, sprite);
      return true;
    }

    // Flat payload with NO entityId — the 2D camera is a singleton resource, and
    // `emit_camera_2d_changed` builds its own camelCase struct rather than
    // serializing the component.
    case 'CAMERA_2D_CHANGED': {
      const camera = parseCamera2dWire(data);
      if (!camera) return true;
      useEditorStore.getState().applyCamera2dFromEngine(camera);
      return true;
    }

    // Flat `{ projectType: "2d" | "3d" }` — the project type is a resource, so
    // there is no entityId. Emitted for every request the engine processes,
    // including the one `load_scene` queues from `metadata.projectType`
    // (#10227). A spelling outside the vocabulary is dropped rather than
    // written: the store's type is a two-member union and every 2D panel
    // gates on `=== '2d'`.
    case 'PROJECT_TYPE_CHANGED': {
      const payload = castPayload<{ projectType: unknown }>(data);
      if (!isSceneProjectType(payload.projectType)) return true;
      useEditorStore.getState().applyProjectTypeFromEngine(payload.projectType);
      return true;
    }

    // `{ entityId, tilemap: Option<TilemapData> }`. `null` is how the engine says
    // the entity has no tilemap, so it drops the entry — routing that through
    // `removeTilemapData` would echo a `remove_tilemap_data` command back at the
    // engine that just reported the removal.
    case 'TILEMAP_CHANGED': {
      const payload = castPayload<{ entityId: string; tilemap: unknown }>(data);
      if (typeof payload.entityId !== 'string') return true;
      const tilemap = payload.tilemap === null || payload.tilemap === undefined
        ? null
        : parseTilemapWire(payload.tilemap);
      if (tilemap === null && payload.tilemap !== null && payload.tilemap !== undefined) {
        return true;
      }
      useEditorStore.getState().applyTilemapFromEngine(payload.entityId, tilemap);
      return true;
    }

    default:
      return false;
  }
}
