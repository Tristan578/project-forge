/**
 * Event handlers for game components, game cameras, input bindings, play tick.
 */

import { useEditorStore, type GameCameraData, firePlayTick } from '@/stores/editorStore';
import { getScriptGameEventCallback } from '@/lib/scripting/useScriptRunner';
import { castPayload, type SetFn, type GetFn } from './types';

export function handleGameEvent(
  type: string,
  data: Record<string, unknown>,
  _set: SetFn,
  _get: GetFn
): boolean {
  switch (type) {
    case 'GAME_COMPONENT_CHANGED': {
      const payload = castPayload<{ entityId: string; components: import('@/stores/editorStore').GameComponentData[] }>(data);
      const state = useEditorStore.getState();
      // Update allGameComponents
      const newAll = { ...state.allGameComponents, [payload.entityId]: payload.components };
      // Update primaryGameComponents if this entity is selected
      const primary = state.primaryId === payload.entityId ? payload.components : state.primaryGameComponents;
      useEditorStore.setState({ allGameComponents: newAll, primaryGameComponents: primary });
      return true;
    }

    case 'GAME_CAMERA_CHANGED': {
      const payload = castPayload<{ entityId: string; mode: string; targetEntity: string | null }>(data);
      const gameCameraData: GameCameraData = {
        mode: payload.mode as GameCameraData['mode'],
        targetEntity: payload.targetEntity || null,
      };
      useEditorStore.getState().setEntityGameCamera(payload.entityId, gameCameraData);
      return true;
    }

    case 'ACTIVE_GAME_CAMERA_CHANGED': {
      const payload = castPayload<{ entityId: string | null }>(data);
      useEditorStore.getState().setActiveGameCameraId(payload.entityId);
      return true;
    }

    case 'PLAY_TICK': {
      const payload = castPayload<{
        entities: Record<string, { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] }>;
        entityInfos: Record<string, { name: string; type: string; colliderRadius: number }>;
        inputState: { pressed: Record<string, boolean>; justPressed: Record<string, boolean>; justReleased: Record<string, boolean>; axes: Record<string, number> };
      }>(data);
      firePlayTick(payload);
      return true;
    }

    case 'GAME_EVENT': {
      // Per-frame game events drained from the engine runtime (win, collectible
      // pickup, …). game_win flips the store flag (drives the HUD win overlay);
      // all events are forwarded to the script worker so forge.game.onWin fires.
      const payload = castPayload<{ eventName: string; sourceEntityId: string | null; targetEntityId: string | null }>(data);
      if (payload.eventName === 'game_win') {
        useEditorStore.getState().setGameWon(true);
      }
      getScriptGameEventCallback()?.(payload);
      return true;
    }

    default:
      return false;
  }
}
