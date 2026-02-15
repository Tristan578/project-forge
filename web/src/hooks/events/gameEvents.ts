/**
 * Event handlers for game components, game cameras, input bindings, play tick.
 */

import { useEditorStore, type GameCameraData, firePlayTick } from '@/stores/editorStore';
import type { SetFn, GetFn } from './types';

export function handleGameEvent(
  type: string,
  data: Record<string, unknown>,
  _set: SetFn,
  _get: GetFn
): boolean {
  switch (type) {
    case 'GAME_COMPONENT_CHANGED': {
      const payload = data as unknown as { entityId: string; components: import('@/stores/editorStore').GameComponentData[] };
      const state = useEditorStore.getState();
      // Update allGameComponents
      const newAll = { ...state.allGameComponents, [payload.entityId]: payload.components };
      // Update primaryGameComponents if this entity is selected
      const primary = state.primaryId === payload.entityId ? payload.components : state.primaryGameComponents;
      useEditorStore.setState({ allGameComponents: newAll, primaryGameComponents: primary });
      return true;
    }

    case 'GAME_CAMERA_CHANGED': {
      const payload = data as unknown as { entityId: string; mode: string; targetEntity: string | null };
      const gameCameraData: GameCameraData = {
        mode: payload.mode as GameCameraData['mode'],
        targetEntity: payload.targetEntity || null,
      };
      useEditorStore.getState().setEntityGameCamera(payload.entityId, gameCameraData);
      return true;
    }

    case 'ACTIVE_GAME_CAMERA_CHANGED': {
      const payload = data as unknown as { entityId: string | null };
      useEditorStore.getState().setActiveGameCameraId(payload.entityId);
      return true;
    }

    case 'PLAY_TICK': {
      const payload = data as unknown as {
        entities: Record<string, { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] }>;
        entityInfos: Record<string, { name: string; type: string; colliderRadius: number }>;
        inputState: { pressed: Record<string, boolean>; justPressed: Record<string, boolean>; justReleased: Record<string, boolean>; axes: Record<string, number> };
      };
      firePlayTick(payload);
      return true;
    }

    default:
      return false;
  }
}
