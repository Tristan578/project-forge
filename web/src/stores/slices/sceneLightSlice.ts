/**
 * Scene-wide light state slice.
 *
 * Provides a pre-computed summary of the lighting setup so AI analysis modules
 * can access light counts without iterating the full scene graph on every call.
 *
 * The state is derived from the scene graph — it is updated whenever nodes are
 * added, removed, or modified, and on full graph replacement.
 */

import { StateCreator } from 'zustand';
import type { SceneGraph, SceneNode } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SceneLightState {
  /** RGBA ambient color (each channel 0–1). Synced from the ambientLight slice. */
  ambientColor: [number, number, number, number];
  /** Ambient brightness value as reported by the engine (0–∞). */
  ambientIntensity: number;
  /** Number of directional light entities in the scene. */
  directionalLights: number;
  /** Number of point light entities in the scene. */
  pointLights: number;
  /** Number of spot light entities in the scene. */
  spotLights: number;
  /** Total count of all light entities (directional + point + spot). */
  totalLightEntities: number;
}

export interface SceneLightSlice {
  sceneLightState: SceneLightState;

  /**
   * Recompute light counts from a full scene graph snapshot.
   * Called when SCENE_GRAPH_UPDATE fires.
   */
  recomputeLightState: (graph: SceneGraph) => void;

  /**
   * Update light counts when a single node is added.
   * Called when SCENE_NODE_ADDED fires.
   */
  onLightNodeAdded: (node: SceneNode) => void;

  /**
   * Update light counts when a single node is removed.
   * Called when SCENE_NODE_REMOVED fires with the node's component list.
   */
  onLightNodeRemoved: (components: string[]) => void;

  /**
   * Update ambient color and intensity from the lighting slice.
   * Called when AMBIENT_LIGHT_CHANGED fires.
   */
  setSceneLightAmbient: (
    color: [number, number, number],
    intensity: number,
  ) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countLights(nodes: Record<string, SceneNode>) {
  let directional = 0;
  let point = 0;
  let spot = 0;

  for (const node of Object.values(nodes)) {
    if (node.components.includes('DirectionalLight')) directional++;
    if (node.components.includes('PointLight')) point++;
    if (node.components.includes('SpotLight')) spot++;
  }

  return { directional, point, spot };
}

function lightDeltaFromComponents(components: string[]) {
  return {
    directional: components.includes('DirectionalLight') ? 1 : 0,
    point: components.includes('PointLight') ? 1 : 0,
    spot: components.includes('SpotLight') ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

const DEFAULT_STATE: SceneLightState = {
  ambientColor: [1, 1, 1, 1],
  ambientIntensity: 300,
  directionalLights: 0,
  pointLights: 0,
  spotLights: 0,
  totalLightEntities: 0,
};

export const createSceneLightSlice: StateCreator<SceneLightSlice, [], [], SceneLightSlice> = (set, _get) => ({
  sceneLightState: { ...DEFAULT_STATE },

  recomputeLightState: (graph) => {
    const { directional, point, spot } = countLights(graph.nodes);
    set((state) => ({
      sceneLightState: {
        ...state.sceneLightState,
        directionalLights: directional,
        pointLights: point,
        spotLights: spot,
        totalLightEntities: directional + point + spot,
      },
    }));
  },

  onLightNodeAdded: (node) => {
    const delta = lightDeltaFromComponents(node.components);
    if (delta.directional === 0 && delta.point === 0 && delta.spot === 0) return;
    set((state) => {
      const s = state.sceneLightState;
      const d = s.directionalLights + delta.directional;
      const p = s.pointLights + delta.point;
      const sp = s.spotLights + delta.spot;
      return {
        sceneLightState: {
          ...s,
          directionalLights: d,
          pointLights: p,
          spotLights: sp,
          totalLightEntities: d + p + sp,
        },
      };
    });
  },

  onLightNodeRemoved: (components) => {
    const delta = lightDeltaFromComponents(components);
    if (delta.directional === 0 && delta.point === 0 && delta.spot === 0) return;
    set((state) => {
      const s = state.sceneLightState;
      const d = Math.max(0, s.directionalLights - delta.directional);
      const p = Math.max(0, s.pointLights - delta.point);
      const sp = Math.max(0, s.spotLights - delta.spot);
      return {
        sceneLightState: {
          ...s,
          directionalLights: d,
          pointLights: p,
          spotLights: sp,
          totalLightEntities: d + p + sp,
        },
      };
    });
  },

  setSceneLightAmbient: (color, intensity) => {
    set((state) => ({
      sceneLightState: {
        ...state.sceneLightState,
        ambientColor: [color[0], color[1], color[2], 1],
        ambientIntensity: intensity,
      },
    }));
  },
});

// ---------------------------------------------------------------------------
// Selector helpers (pure functions for consumers)
// ---------------------------------------------------------------------------

/**
 * Returns true when the scene has at least one light source of any type
 * (ambient only does not count as a scene light entity).
 */
export function hasSceneLights(state: SceneLightSlice): boolean {
  return state.sceneLightState.totalLightEntities > 0;
}

/**
 * Returns a human-readable summary string for debugging / AI context injection.
 */
export function describeSceneLights(state: SceneLightSlice): string {
  const s = state.sceneLightState;
  const parts: string[] = [];
  if (s.directionalLights > 0) parts.push(`${s.directionalLights} directional`);
  if (s.pointLights > 0) parts.push(`${s.pointLights} point`);
  if (s.spotLights > 0) parts.push(`${s.spotLights} spot`);
  if (parts.length === 0) return 'no light entities';
  return parts.join(', ');
}
