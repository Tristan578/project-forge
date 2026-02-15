/**
 * Scene slice - manages scene file state, multi-scene, export, cloud state, terrain, and scene transitions.
 * TODO: Extract full implementation from editorStore.ts
 */

import { StateCreator } from 'zustand';
import type { SceneTransitionConfig, TerrainDataState } from './types';

const DEFAULT_TRANSITION: SceneTransitionConfig = {
  type: 'fade',
  duration: 500,
  color: '#000000',
  easing: 'ease-in-out',
};

export interface SceneSlice {
  sceneName: string;
  sceneModified: boolean;
  autoSaveEnabled: boolean;
  scenes: Array<{ id: string; name: string; isStartScene: boolean }>;
  activeSceneId: string | null;
  sceneSwitching: boolean;
  sceneTransition: {
    active: boolean;
    config: SceneTransitionConfig | null;
    targetScene: string | null;
  };
  defaultTransition: SceneTransitionConfig;
  terrainData: Record<string, TerrainDataState>;
  isExporting: boolean;
  projectId: string | null;
  cloudSaveStatus: 'idle' | 'saving' | 'saved' | 'error';
  lastCloudSave: string | null;

  saveScene: () => void;
  loadScene: (json: string) => void;
  newScene: () => void;
  setSceneName: (name: string) => void;
  setSceneModified: (modified: boolean) => void;
  setAutoSaveEnabled: (enabled: boolean) => void;
  setScenes: (scenes: Array<{ id: string; name: string; isStartScene: boolean }>, activeId: string | null) => void;
  setSceneSwitching: (switching: boolean) => void;
  startSceneTransition: (targetScene: string, configOverride?: Partial<SceneTransitionConfig>) => Promise<void>;
  setDefaultTransition: (config: Partial<SceneTransitionConfig>) => void;
  spawnTerrain: (terrainData?: Partial<TerrainDataState>) => void;
  updateTerrain: (entityId: string, terrainData: TerrainDataState) => void;
  sculptTerrain: (entityId: string, position: [number, number], radius: number, strength: number) => void;
  setTerrainData: (entityId: string, data: TerrainDataState) => void;
  csgUnion: (entityIdA: string, entityIdB: string, deleteSources?: boolean) => void;
  csgSubtract: (entityIdA: string, entityIdB: string, deleteSources?: boolean) => void;
  csgIntersect: (entityIdA: string, entityIdB: string, deleteSources?: boolean) => void;
  extrudeShape: (shape: string, params: Record<string, unknown>) => void;
  latheShape: (profile: [number, number][], params: Record<string, unknown>) => void;
  arrayEntity: (entityId: string, params: Record<string, unknown>) => void;
  combineMeshes: (entityIds: string[], deleteSources?: boolean, name?: string) => void;
  setExporting: (value: boolean) => void;
  setProjectId: (id: string | null) => void;
  saveToCloud: () => void;
  setCloudSaveStatus: (status: 'idle' | 'saving' | 'saved' | 'error') => void;
  loadTemplate: (templateId: string) => Promise<void>;
}

let dispatchCommand: ((command: string, payload: unknown) => void) | null = null;

export function setSceneDispatcher(dispatcher: (command: string, payload: unknown) => void): void {
  dispatchCommand = dispatcher;
}

export const createSceneSlice: StateCreator<SceneSlice, [], [], SceneSlice> = (set, get) => ({
  sceneName: 'Untitled',
  sceneModified: false,
  autoSaveEnabled: true,
  scenes: [],
  activeSceneId: null,
  sceneSwitching: false,
  sceneTransition: { active: false, config: null, targetScene: null },
  defaultTransition: DEFAULT_TRANSITION,
  terrainData: {},
  isExporting: false,
  projectId: null,
  cloudSaveStatus: 'idle',
  lastCloudSave: null,

  saveScene: () => {
    if (dispatchCommand) dispatchCommand('save_scene', {});
  },
  loadScene: (json) => {
    if (dispatchCommand) dispatchCommand('load_scene', { json });
  },
  newScene: () => {
    if (dispatchCommand) dispatchCommand('new_scene', {});
  },
  setSceneName: (name) => set({ sceneName: name }),
  setSceneModified: (modified) => set({ sceneModified: modified }),
  setAutoSaveEnabled: (enabled) => set({ autoSaveEnabled: enabled }),
  setScenes: (scenes, activeId) => set({ scenes, activeSceneId: activeId }),
  setSceneSwitching: (switching) => set({ sceneSwitching: switching }),
  startSceneTransition: async (targetScene, configOverride) => {
    const state = get();

    // Validate target scene exists
    const targetExists = state.scenes.find(s => s.name === targetScene || s.id === targetScene);
    if (!targetExists) {
      console.error(`Scene "${targetScene}" not found`);
      return;
    }

    const config = { ...state.defaultTransition, ...(configOverride || {}) };
    set({ sceneTransition: { active: true, config, targetScene } });
    // Simulate transition
    await new Promise(resolve => setTimeout(resolve, config.duration));
    set({ sceneTransition: { active: false, config: null, targetScene: null } });
  },
  setDefaultTransition: (config) => {
    const state = get();
    set({ defaultTransition: { ...state.defaultTransition, ...config } });
  },
  spawnTerrain: (terrainData) => {
    if (dispatchCommand) dispatchCommand('spawn_terrain', terrainData || {});
  },
  updateTerrain: (entityId, terrainData) => {
    if (dispatchCommand) dispatchCommand('update_terrain', { entityId, ...terrainData });
  },
  sculptTerrain: (entityId, position, radius, strength) => {
    if (dispatchCommand) dispatchCommand('sculpt_terrain', { entityId, position, radius, strength });
  },
  setTerrainData: (entityId, data) => {
    set(state => ({ terrainData: { ...state.terrainData, [entityId]: data } }));
  },
  csgUnion: (entityIdA, entityIdB, deleteSources) => {
    if (dispatchCommand) dispatchCommand('csg_union', { entityIdA, entityIdB, deleteSources });
  },
  csgSubtract: (entityIdA, entityIdB, deleteSources) => {
    if (dispatchCommand) dispatchCommand('csg_subtract', { entityIdA, entityIdB, deleteSources });
  },
  csgIntersect: (entityIdA, entityIdB, deleteSources) => {
    if (dispatchCommand) dispatchCommand('csg_intersect', { entityIdA, entityIdB, deleteSources });
  },
  extrudeShape: (shape, params) => {
    if (dispatchCommand) dispatchCommand('extrude_shape', { shape, ...params });
  },
  latheShape: (profile, params) => {
    if (dispatchCommand) dispatchCommand('lathe_shape', { profile, ...params });
  },
  arrayEntity: (entityId, params) => {
    if (dispatchCommand) dispatchCommand('array_entity', { entityId, ...params });
  },
  combineMeshes: (entityIds, deleteSources, name) => {
    if (dispatchCommand) dispatchCommand('combine_meshes', { entityIds, deleteSources, name });
  },
  setExporting: (value) => set({ isExporting: value }),
  setProjectId: (id) => set({ projectId: id }),
  saveToCloud: () => {
    // Cloud save implementation
  },
  setCloudSaveStatus: (status) => set({ cloudSaveStatus: status }),
  loadTemplate: async (_templateId) => {
    // Template loading implementation
  },
});
