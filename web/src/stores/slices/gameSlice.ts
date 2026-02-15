/**
 * Game slice - manages game components, game cameras, mobile controls, HUD, and engine mode.
 * TODO: Extract full implementation from editorStore.ts
 */

import { StateCreator } from 'zustand';
import type { GameComponentData, GameCameraData, MobileTouchConfig, HudElement, EngineMode } from './types';

export interface GameSlice {
  allGameComponents: Record<string, GameComponentData[]>;
  primaryGameComponents: GameComponentData[] | null;
  allGameCameras: Record<string, GameCameraData>;
  activeGameCameraId: string | null;
  primaryGameCamera: GameCameraData | null;
  mobileTouchConfig: MobileTouchConfig;
  hudElements: HudElement[];
  engineMode: EngineMode;

  addGameComponent: (entityId: string, component: GameComponentData) => void;
  updateGameComponent: (entityId: string, component: GameComponentData) => void;
  removeGameComponent: (entityId: string, componentName: string) => void;
  setGameCamera: (entityId: string, data: GameCameraData) => void;
  removeGameCamera: (entityId: string) => void;
  setActiveGameCamera: (entityId: string | null) => void;
  cameraShake: (entityId: string, intensity: number, duration: number) => void;
  setEntityGameCamera: (entityId: string, data: GameCameraData | null) => void;
  setActiveGameCameraId: (entityId: string | null) => void;
  setMobileTouchConfig: (config: MobileTouchConfig) => void;
  updateMobileTouchConfig: (partial: Partial<MobileTouchConfig>) => void;
  setHudElements: (elements: HudElement[]) => void;
  play: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  setEngineMode: (mode: EngineMode) => void;
}

let dispatchCommand: ((command: string, payload: unknown) => void) | null = null;

export function setGameDispatcher(dispatcher: (command: string, payload: unknown) => void): void {
  dispatchCommand = dispatcher;
}

export const createGameSlice: StateCreator<GameSlice, [], [], GameSlice> = (set, get) => ({
  allGameComponents: {},
  primaryGameComponents: null,
  allGameCameras: {},
  activeGameCameraId: null,
  primaryGameCamera: null,
  mobileTouchConfig: {
    enabled: true,
    autoDetect: true,
    preset: 'platformer',
    joystick: { position: 'bottom-left', size: 120, deadZone: 0.15, opacity: 0.6, mode: 'floating', actions: { horizontal: 'move_right', vertical: 'move_forward' } },
    buttons: [{ id: 'jump', action: 'jump', position: { x: 85, y: 75 }, size: 80, icon: '↑', opacity: 0.6 }],
    preferredOrientation: 'any',
    autoReduceQuality: true,
  },
  hudElements: [],
  engineMode: 'edit',

  addGameComponent: (entityId, component) => {
    set(state => ({
      allGameComponents: {
        ...state.allGameComponents,
        [entityId]: [...(state.allGameComponents[entityId] || []), component],
      },
    }));
    if (dispatchCommand) dispatchCommand('add_game_component', { entityId, component });
  },
  updateGameComponent: (entityId, component) => {
    set(state => ({
      allGameComponents: {
        ...state.allGameComponents,
        [entityId]: (state.allGameComponents[entityId] || []).map(c => c.type === component.type ? component : c),
      },
    }));
    if (dispatchCommand) dispatchCommand('update_game_component', { entityId, component });
  },
  removeGameComponent: (entityId, componentName) => {
    set(state => ({
      allGameComponents: {
        ...state.allGameComponents,
        [entityId]: (state.allGameComponents[entityId] || []).filter(c => c.type !== componentName),
      },
    }));
    if (dispatchCommand) dispatchCommand('remove_game_component', { entityId, componentName });
  },
  setGameCamera: (entityId, data) => {
    set(state => ({ allGameCameras: { ...state.allGameCameras, [entityId]: data } }));
    if (dispatchCommand) dispatchCommand('set_game_camera', { entityId, ...data });
  },
  removeGameCamera: (entityId) => {
    set(state => {
      const { [entityId]: _, ...rest } = state.allGameCameras;
      return { allGameCameras: rest };
    });
    if (dispatchCommand) dispatchCommand('remove_game_camera', { entityId });
  },
  setActiveGameCamera: (entityId) => {
    set({ activeGameCameraId: entityId });
    if (dispatchCommand) dispatchCommand('set_active_game_camera', { entityId });
  },
  cameraShake: (entityId, intensity, duration) => {
    if (dispatchCommand) dispatchCommand('camera_shake', { entityId, intensity, duration });
  },
  setEntityGameCamera: (_entityId, data) => set({ primaryGameCamera: data }),
  setActiveGameCameraId: (entityId) => set({ activeGameCameraId: entityId }),
  setMobileTouchConfig: (config) => set({ mobileTouchConfig: config }),
  updateMobileTouchConfig: (partial) => {
    const state = get();
    set({ mobileTouchConfig: { ...state.mobileTouchConfig, ...partial } });
  },
  setHudElements: (elements) => set({ hudElements: elements }),
  play: () => {
    if (dispatchCommand) dispatchCommand('play', {});
  },
  stop: () => {
    if (dispatchCommand) dispatchCommand('stop', {});
  },
  pause: () => {
    if (dispatchCommand) dispatchCommand('pause', {});
  },
  resume: () => {
    if (dispatchCommand) dispatchCommand('resume', {});
  },
  setEngineMode: (mode) => set({ engineMode: mode }),
});
