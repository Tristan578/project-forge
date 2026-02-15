/**
 * Event handlers for sprites, sprite sheets, sprite animation, tilemaps, tilesets, project type.
 */

import { useEditorStore } from '@/stores/editorStore';
import type { SetFn, GetFn } from './types';

export function handleSpriteEvent(
  type: string,
  data: Record<string, unknown>,
  _set: SetFn,
  _get: GetFn
): boolean {
  switch (type) {
    case 'SPRITE_UPDATED': {
      const payload = data as unknown as { entityId: string; sprite: import('@/stores/editorStore').SpriteData };
      useEditorStore.getState().setSpriteData(payload.entityId, payload.sprite);
      return true;
    }

    case 'SPRITE_SHEET_UPDATED': {
      const payload = data as unknown as { entityId: string; spriteSheet: import('@/stores/editorStore').SpriteSheetData };
      useEditorStore.getState().setSpriteSheet(payload.entityId, payload.spriteSheet);
      return true;
    }

    case 'SPRITE_ANIMATOR_UPDATED': {
      const payload = data as unknown as { entityId: string; animator: import('@/stores/editorStore').SpriteAnimatorData };
      useEditorStore.getState().setSpriteAnimator(payload.entityId, payload.animator);
      return true;
    }

    case 'ANIMATION_STATE_MACHINE_UPDATED': {
      const payload = data as unknown as { entityId: string; stateMachine: import('@/stores/editorStore').AnimationStateMachineData };
      useEditorStore.getState().setAnimationStateMachine(payload.entityId, payload.stateMachine);
      return true;
    }

    case 'PROJECT_TYPE_CHANGED': {
      const payload = data as unknown as { projectType: '2d' | '3d' };
      useEditorStore.getState().setProjectType(payload.projectType);
      return true;
    }

    case 'CAMERA2D_UPDATED': {
      const payload = data as unknown as import('@/stores/editorStore').Camera2dData;
      useEditorStore.getState().setCamera2dData(payload);
      return true;
    }

    case 'TILEMAP_UPDATED': {
      const payload = data as unknown as import('@/stores/editorStore').TilemapData & { entityId: string };
      const { entityId, ...tileData } = payload;
      useEditorStore.getState().setTilemapData(entityId, tileData);
      return true;
    }

    case 'TILEMAP_REMOVED': {
      const payload = data as unknown as { entityId: string };
      useEditorStore.getState().removeTilemapData(payload.entityId);
      return true;
    }

    case 'TILESET_LOADED': {
      const payload = data as unknown as import('@/stores/editorStore').TilesetData & { assetId: string };
      const { assetId, ...rest } = payload;
      useEditorStore.getState().setTileset(assetId, { assetId, ...rest });
      return true;
    }

    default:
      return false;
  }
}
