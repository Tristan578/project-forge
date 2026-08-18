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
 *   PROJECT_TYPE_CHANGED, TILEMAP_REMOVED, TILESET_LOADED
 * Sprite sheets, sprite animators, animation state machines, project type and
 * tilesets therefore have no engine→store path at all; that is an engine-side
 * emitter gap, tracked separately from this file.
 */

import { useEditorStore } from '@/stores/editorStore';
import {
  parseSpriteWire,
  parseCamera2dWire,
  parseTilemapWire,
} from '@/lib/sprite/sprite2dPayload';
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
