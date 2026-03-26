/**
 * Event handlers for sprites, sprite sheets, sprite animation, tilemaps, tilesets, project type.
 */

import { useEditorStore } from '@/stores/editorStore';
import { castPayload, type SetFn, type GetFn } from './types';

export function handleSpriteEvent(
  type: string,
  data: Record<string, unknown>,
  _set: SetFn,
  _get: GetFn
): boolean {
  switch (type) {
    case 'SPRITE_UPDATED': {
      const payload = castPayload<{ entityId: string; sprite: import('@/stores/editorStore').SpriteData }>(data);
      useEditorStore.getState().setSpriteData(payload.entityId, payload.sprite);
      return true;
    }

    case 'SPRITE_SHEET_UPDATED': {
      const payload = castPayload<{ entityId: string; spriteSheet: import('@/stores/editorStore').SpriteSheetData }>(data);
      useEditorStore.getState().setSpriteSheet(payload.entityId, payload.spriteSheet);
      return true;
    }

    case 'SPRITE_ANIMATOR_UPDATED': {
      const payload = castPayload<{ entityId: string; animator: import('@/stores/editorStore').SpriteAnimatorData }>(data);
      useEditorStore.getState().setSpriteAnimator(payload.entityId, payload.animator);
      return true;
    }

    case 'ANIMATION_STATE_MACHINE_UPDATED': {
      const payload = castPayload<{ entityId: string; stateMachine: import('@/stores/editorStore').AnimationStateMachineData }>(data);
      useEditorStore.getState().setAnimationStateMachine(payload.entityId, payload.stateMachine);
      return true;
    }

    case 'PROJECT_TYPE_CHANGED': {
      const payload = castPayload<{ projectType: '2d' | '3d' }>(data);
      useEditorStore.getState().setProjectType(payload.projectType);
      return true;
    }

    case 'CAMERA2D_UPDATED': {
      const payload = castPayload<import('@/stores/editorStore').Camera2dData>(data);
      useEditorStore.getState().setCamera2dData(payload);
      return true;
    }

    case 'TILEMAP_UPDATED': {
      const payload = castPayload<import('@/stores/editorStore').TilemapData & { entityId: string }>(data);
      const { entityId, ...tileData } = payload;
      useEditorStore.getState().setTilemapData(entityId, tileData);
      return true;
    }

    case 'TILEMAP_REMOVED': {
      const payload = castPayload<{ entityId: string }>(data);
      useEditorStore.getState().removeTilemapData(payload.entityId);
      return true;
    }

    case 'TILESET_LOADED': {
      const payload = castPayload<import('@/stores/editorStore').TilesetData & { assetId: string }>(data);
      const { assetId, ...rest } = payload;
      useEditorStore.getState().setTileset(assetId, { assetId, ...rest });
      return true;
    }

    default:
      return false;
  }
}
