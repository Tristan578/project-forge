/**
 * Event handlers for transform/scene graph/selection/history/snap/mode.
 */

import { useEditorStore, type SceneGraph, type TransformData, type SnapSettings, type CameraPreset, type CoordinateMode, type EngineMode } from '@/stores/editorStore';
import { saveAutoSave } from '@/lib/sceneFile';
import { setLastExportedScene } from '@/lib/storage/autoSave';
import { invalidateSceneCache } from '@/lib/ai/cachedContext';
import type { SceneNode } from '@/stores/slices/types';
import type { SetFn, GetFn } from './types';

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
      const payload = data as unknown as { selectedIds: string[]; primaryId: string | null; primaryName: string | null };
      useEditorStore.getState().setSelection(
        payload.selectedIds,
        payload.primaryId,
        payload.primaryName
      );
      return true;
    }

    case 'SCENE_GRAPH_UPDATE': {
      const payload = data as unknown as SceneGraph;
      useEditorStore.getState().setFullGraph(payload);
      // Mark scene as modified and trigger debounced auto-save
      useEditorStore.setState({ sceneModified: true });
      scheduleAutoSave();
      // Invalidate scene context cache so the next AI call rebuilds it
      invalidateSceneCache();
      return true;
    }

    case 'SCENE_NODE_ADDED': {
      const node = data as unknown as SceneNode;
      useEditorStore.getState().addNode(node);
      useEditorStore.setState({ sceneModified: true });
      scheduleAutoSave();
      return true;
    }

    case 'SCENE_NODE_REMOVED': {
      const payload = data as unknown as { entityId: string };
      useEditorStore.getState().removeNode(payload.entityId);
      useEditorStore.setState({ sceneModified: true });
      scheduleAutoSave();
      return true;
    }

    case 'SCENE_NODE_UPDATED': {
      const payload = data as unknown as { entityId: string } & Partial<SceneNode>;
      const { entityId, ...changes } = payload;
      useEditorStore.getState().updateNode(entityId, changes);
      useEditorStore.setState({ sceneModified: true });
      scheduleAutoSave();
      return true;
    }

    case 'TRANSFORM_CHANGED': {
      const payload = data as unknown as TransformData;
      useEditorStore.getState().setPrimaryTransform(payload);
      return true;
    }

    case 'HISTORY_CHANGED': {
      const payload = data as unknown as { canUndo: boolean; canRedo: boolean; undoDescription: string | null; redoDescription: string | null };
      useEditorStore.getState().setHistoryState(
        payload.canUndo,
        payload.canRedo,
        payload.undoDescription,
        payload.redoDescription
      );
      return true;
    }

    case 'SNAP_SETTINGS_CHANGED': {
      const payload = data as unknown as SnapSettings;
      useEditorStore.getState().setSnapSettings(payload);
      return true;
    }

    case 'VIEW_PRESET_CHANGED': {
      const payload = data as unknown as { preset: CameraPreset; displayName: string | null };
      useEditorStore.getState().setCurrentCameraPreset(payload.preset);
      return true;
    }

    case 'COORDINATE_MODE_CHANGED': {
      const payload = data as unknown as { mode: CoordinateMode; displayName: string };
      // Update store without sending command back (avoids infinite loop)
      useEditorStore.setState({ coordinateMode: payload.mode });
      return true;
    }

    case 'REPARENT_RESULT': {
      const payload = data as unknown as { success: boolean; entityId: string; error?: string };
      if (!payload.success) {
        console.error(
          `Failed to reparent entity ${payload.entityId}: ${payload.error}`
        );
      }
      return true;
    }

    case 'ENGINE_MODE_CHANGED': {
      const payload = data as unknown as { mode: EngineMode };
      useEditorStore.setState({ engineMode: payload.mode });
      return true;
    }

    case 'SCENE_EXPORTED': {
      const payload = data as unknown as { json: string; name: string };
      const { json, name } = payload;
      const state = useEditorStore.getState();

      // Cache for periodic IndexedDB auto-save
      setLastExportedScene(json, name);

      // Keep a rolling sessionStorage backup so EnginePanicRecovery can read
      // the most-recent scene JSON without triggering a fresh WASM export
      // (which may fail if the engine has already panicked). PF-823.
      try {
        sessionStorage.setItem('forge:scene-last-json', json);
      } catch { /* sessionStorage may be unavailable in restricted contexts */ }

      if (state.autoSaveEnabled) {
        // Auto-save to localStorage with quota management and LRU eviction
        saveAutoSave(json, name);
      }
      // Reset sceneModified since the scene has been persisted (PF-528)
      useEditorStore.setState({ sceneModified: false });
      // Dispatch DOM event so SceneToolbar can trigger file download
      window.dispatchEvent(new CustomEvent('forge:scene-exported', { detail: { json, name } }));
      return true;
    }

    case 'SCENE_LOADED': {
      const payload = data as unknown as { name: string };
      useEditorStore.setState({
        sceneName: payload.name,
        sceneModified: false,
        primaryMaterial: null,
        primaryLight: null,
        primaryPhysics: null,
        physicsEnabled: false,
        primaryAnimation: null,
      });
      return true;
    }

    default:
      return false;
  }
}
