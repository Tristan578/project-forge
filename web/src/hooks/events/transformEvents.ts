/**
 * Event handlers for transform/scene graph/selection/history/snap/mode.
 */

import { useEditorStore, type SceneGraph, type TransformData, type SnapSettings, type CameraPreset, type CoordinateMode, type EngineMode } from '@/stores/editorStore';
import { saveAutoSave } from '@/lib/sceneFile';
import { setLastExportedScene } from '@/lib/storage/autoSave';
import { invalidateSceneCache } from '@/lib/ai/cachedContext';
import type { SceneNode } from '@/stores/slices/types';
import { castPayload, type SetFn, type GetFn } from './types';

const TRANSFORM_DEBOUNCE_MS = 2000;

// Debounced auto-save: triggers export_scene command after inactivity
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    const state = useEditorStore.getState();
    if (state.autoSaveEnabled && state.engineMode === 'edit') {
      state.saveScene();
    }
  }, TRANSFORM_DEBOUNCE_MS);
}

export function handleTransformEvent(
  type: string,
  data: Record<string, unknown>,
  _set: SetFn,
  _get: GetFn
): boolean {
  switch (type) {
    case 'SELECTION_CHANGED': {
      const payload = castPayload<{ selectedIds: string[]; primaryId: string | null; primaryName: string | null }>(data);
      useEditorStore.getState().setSelection(
        payload.selectedIds,
        payload.primaryId,
        payload.primaryName
      );
      return true;
    }

    case 'SCENE_GRAPH_UPDATE': {
      const payload = castPayload<SceneGraph>(data);
      useEditorStore.getState().setFullGraph(payload);
      useEditorStore.getState().recomputeLightState(payload);
      // Mark scene as modified and trigger debounced auto-save
      useEditorStore.setState({ sceneModified: true });
      scheduleAutoSave();
      // Invalidate scene context cache so the next AI call rebuilds it
      invalidateSceneCache();
      return true;
    }

    case 'SCENE_NODE_ADDED': {
      const node = castPayload<SceneNode>(data);
      useEditorStore.getState().addNode(node);
      useEditorStore.getState().onLightNodeAdded(node);
      useEditorStore.setState({ sceneModified: true });
      scheduleAutoSave();
      invalidateSceneCache(); // PF-319: AI must see new entities
      return true;
    }

    case 'SCENE_NODE_REMOVED': {
      const payload = castPayload<{ entityId: string }>(data);
      const removedNode = useEditorStore.getState().sceneGraph.nodes[payload.entityId];
      useEditorStore.getState().removeNode(payload.entityId);
      if (removedNode) {
        useEditorStore.getState().onLightNodeRemoved(removedNode.components);
      }
      useEditorStore.setState({ sceneModified: true });
      scheduleAutoSave();
      invalidateSceneCache(); // PF-319: AI must not see deleted entities
      return true;
    }

    case 'SCENE_NODE_UPDATED': {
      const payload = castPayload<{ entityId: string } & Partial<SceneNode>>(data);
      const { entityId, ...changes } = payload;
      useEditorStore.getState().updateNode(entityId, changes);
      useEditorStore.setState({ sceneModified: true });
      scheduleAutoSave();
      invalidateSceneCache(); // PF-319: AI must see renamed/modified entities
      return true;
    }

    case 'TRANSFORM_CHANGED': {
      const payload = castPayload<TransformData>(data);
      useEditorStore.getState().setPrimaryTransform(payload);
      return true;
    }

    case 'HISTORY_CHANGED': {
      const payload = castPayload<{ canUndo: boolean; canRedo: boolean; undoDescription: string | null; redoDescription: string | null }>(data);
      useEditorStore.getState().setHistoryState(
        payload.canUndo,
        payload.canRedo,
        payload.undoDescription,
        payload.redoDescription
      );
      return true;
    }

    case 'SNAP_SETTINGS_CHANGED': {
      const payload = castPayload<SnapSettings>(data);
      useEditorStore.getState().setSnapSettings(payload);
      return true;
    }

    case 'VIEW_PRESET_CHANGED': {
      const payload = castPayload<{ preset: CameraPreset; displayName: string | null }>(data);
      useEditorStore.getState().setCurrentCameraPreset(payload.preset);
      return true;
    }

    case 'COORDINATE_MODE_CHANGED': {
      const payload = castPayload<{ mode: CoordinateMode; displayName: string }>(data);
      // Update store without sending command back (avoids infinite loop)
      useEditorStore.setState({ coordinateMode: payload.mode });
      return true;
    }

    case 'REPARENT_RESULT': {
      const payload = castPayload<{ success: boolean; entityId: string; error?: string }>(data);
      if (!payload.success) {
        console.error(
          `Failed to reparent entity ${payload.entityId}: ${payload.error}`
        );
      }
      return true;
    }

    case 'ENGINE_MODE_CHANGED': {
      const payload = castPayload<{ mode: EngineMode }>(data);
      useEditorStore.setState({ engineMode: payload.mode });
      return true;
    }

    case 'SCENE_EXPORTED': {
      const payload = castPayload<{ json: string; name: string }>(data);
      const { json, name } = payload;
      const state = useEditorStore.getState();

      // Cache for periodic IndexedDB auto-save
      setLastExportedScene(json, name);

      if (state.autoSaveEnabled) {
        // Auto-save to localStorage with quota management and LRU eviction
        saveAutoSave(json, name);
      }
      // Write a sessionStorage backup for panic recovery (PF-823).
      // This survives page reloads within the same browser session so
      // EnginePanicRecovery can offer to restore the last known-good scene.
      try {
        sessionStorage.setItem('forge:scene-last-json', json);
      } catch {
        // sessionStorage may be unavailable (private browsing quota, etc.) — fail silently
      }
      // Reset sceneModified since the scene has been persisted (PF-528)
      useEditorStore.setState({ sceneModified: false });
      // Dispatch DOM event so SceneToolbar can trigger file download
      window.dispatchEvent(new CustomEvent('forge:scene-exported', { detail: { json, name } }));
      return true;
    }

    case 'SCENE_LOADED': {
      const payload = castPayload<{ name: string }>(data);
      useEditorStore.setState({
        sceneName: payload.name,
        sceneModified: false,
        primaryMaterial: null,
        primaryLight: null,
        primaryPhysics: null,
        physicsEnabled: false,
        primaryAnimation: null,
      });
      invalidateSceneCache(); // PF-319: new scene = completely new context
      return true;
    }

    default:
      return false;
  }
}
