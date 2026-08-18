import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSetGet, createMockActions, type StoreState } from './eventTestUtils';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}));

import { useEditorStore } from '@/stores/editorStore';
import { handleSpriteEvent } from '../spriteEvents';

describe('handleSpriteEvent', () => {
  let actions: ReturnType<typeof createMockActions>;
  let mockSetGet: ReturnType<typeof createMockSetGet>;

  beforeEach(() => {
    actions = createMockActions();
    mockSetGet = createMockSetGet();
    vi.mocked(useEditorStore.getState).mockReturnValue(actions as unknown as StoreState);
  });

  const dispatch = (type: string, payload: unknown) =>
    handleSpriteEvent(type, payload as Record<string, unknown>, mockSetGet.set, mockSetGet.get);

  it('returns false for unknown event types', () => {
    expect(dispatch('UNKNOWN', {})).toBe(false);
  });

  /**
   * These names had `case` arms for the whole life of this file and NOTHING in
   * `engine/src/bridge/events.rs` has ever emitted any of them, so every handler
   * was dead and every test asserting one passed against a wire format that
   * existed only in the suite. They are pinned as unhandled so a stub cannot come
   * back: verify an event name against the engine's emitters, never against a test.
   */
  describe('events the engine never emits', () => {
    const phantoms = [
      'SPRITE_UPDATED',
      'CAMERA2D_UPDATED',
      'TILEMAP_UPDATED',
      'SPRITE_SHEET_UPDATED',
      'SPRITE_ANIMATOR_UPDATED',
      'ANIMATION_STATE_MACHINE_UPDATED',
      'PROJECT_TYPE_CHANGED',
      'TILEMAP_REMOVED',
      'TILESET_LOADED',
    ];

    it.each(phantoms)('%s is unhandled and touches no store action', (name) => {
      expect(dispatch(name, { entityId: 'ent-1', assetId: 'asset-1' })).toBe(false);
      for (const value of Object.values(actions)) {
        if (typeof value === 'function' && 'mock' in value) {
          expect(value).not.toHaveBeenCalled();
        }
      }
    });
  });

  describe('SPRITE_CHANGED', () => {
    // The engine's `SpriteData` has no `#[serde(rename_all)]`, so the body is
    // snake_case inside a camelCase envelope. Reading camelCase keys here yielded
    // an all-`undefined` record.
    const wire = {
      texture_asset_id: 'tex-1',
      color_tint: [0.5, 0.25, 0.125, 1],
      flip_x: true,
      flip_y: false,
      custom_size: [64, 32],
      sorting_layer: 'Foreground',
      sorting_order: 3,
      anchor: 'TopLeft',
    };

    it('translates the snake_case wire body into the store shape', () => {
      expect(dispatch('SPRITE_CHANGED', { entityId: 'ent-1', sprite: wire })).toBe(true);
      expect(actions.applySpriteFromEngine).toHaveBeenCalledWith('ent-1', {
        textureAssetId: 'tex-1',
        colorTint: [0.5, 0.25, 0.125, 1],
        flipX: true,
        flipY: false,
        customSize: [64, 32],
        sortingLayer: 'Foreground',
        sortingOrder: 3,
        anchor: 'top_left',
      });
    });

    it('routes through the state-only action, never the dispatching one', () => {
      dispatch('SPRITE_CHANGED', { entityId: 'ent-1', sprite: wire });
      expect(actions.setSpriteData).not.toHaveBeenCalled();
    });

    it('drops the entry when the engine reports no sprite', () => {
      expect(dispatch('SPRITE_CHANGED', { entityId: 'ent-1', sprite: null })).toBe(true);
      expect(actions.applySpriteFromEngine).toHaveBeenCalledWith('ent-1', null);
    });

    it('leaves the store alone when the body is malformed', () => {
      expect(dispatch('SPRITE_CHANGED', { entityId: 'ent-1', sprite: 'nonsense' })).toBe(true);
      expect(actions.applySpriteFromEngine).not.toHaveBeenCalled();
    });

    it('ignores a payload with no entity id', () => {
      expect(dispatch('SPRITE_CHANGED', { sprite: wire })).toBe(true);
      expect(actions.applySpriteFromEngine).not.toHaveBeenCalled();
    });
  });

  describe('CAMERA_2D_CHANGED', () => {
    it('reads the flat, entityId-less payload the emitter builds', () => {
      expect(
        dispatch('CAMERA_2D_CHANGED', {
          zoom: 2,
          pixelPerfect: true,
          bounds: { minX: -100, maxX: 100, minY: -50, maxY: 50 },
        })
      ).toBe(true);
      expect(actions.applyCamera2dFromEngine).toHaveBeenCalledWith({
        zoom: 2,
        pixelPerfect: true,
        bounds: { minX: -100, maxX: 100, minY: -50, maxY: 50 },
      });
      expect(actions.setCamera2dData).not.toHaveBeenCalled();
    });

    it('carries absent bounds through as null', () => {
      dispatch('CAMERA_2D_CHANGED', { zoom: 1, pixelPerfect: false, bounds: null });
      expect(actions.applyCamera2dFromEngine).toHaveBeenCalledWith({
        zoom: 1,
        pixelPerfect: false,
        bounds: null,
      });
    });
  });

  describe('TILEMAP_CHANGED', () => {
    const wire = {
      tilesetAssetId: 'tiles-1',
      tileSize: [16, 16],
      mapSize: [3, 2],
      layers: [
        { name: 'Ground', tiles: [0, 1, null, 2, null, 3], visible: true, opacity: 1, isCollision: false },
      ],
      origin: 'TopLeft',
    };

    it('reads the tilemap out of the envelope', () => {
      expect(dispatch('TILEMAP_CHANGED', { entityId: 'tm-1', tilemap: wire })).toBe(true);
      expect(actions.applyTilemapFromEngine).toHaveBeenCalledWith('tm-1', wire);
      expect(actions.setTilemapData).not.toHaveBeenCalled();
    });

    it('drops the entry when the engine reports no tilemap', () => {
      expect(dispatch('TILEMAP_CHANGED', { entityId: 'tm-1', tilemap: null })).toBe(true);
      expect(actions.applyTilemapFromEngine).toHaveBeenCalledWith('tm-1', null);
      // Not `removeTilemapData` — that dispatches `remove_tilemap_data` back at the
      // engine that just reported the removal.
      expect(actions.removeTilemapData).not.toHaveBeenCalled();
    });

    it('leaves the store alone when layers are malformed', () => {
      expect(
        dispatch('TILEMAP_CHANGED', {
          entityId: 'tm-1',
          tilemap: { ...wire, layers: [{ name: 'Ground', tiles: 'not-an-array' }] },
        })
      ).toBe(true);
      expect(actions.applyTilemapFromEngine).not.toHaveBeenCalled();
    });
  });
});
