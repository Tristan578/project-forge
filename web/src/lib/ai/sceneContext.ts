/**
 * Scene context builder for AI game modification.
 * Extracts a minimal, structured representation of the current scene
 * that can be included in AI prompts for modification planning.
 */

import type { SceneGraph, SceneNode } from '@/stores/slices/types';

/** Lightweight entity representation for AI context. */
export interface EntitySummary {
  id: string;
  name: string;
  type: string;
  components: string[];
  visible: boolean;
  parentId: string | null;
}

export interface SceneSettings {
  ambientLight: { color: [number, number, number]; brightness: number };
  environment: {
    clearColor: [number, number, number];
    fogEnabled: boolean;
    skyboxPreset: string | null;
  };
  engineMode: string;
}

/** Structured scene context for AI modification planning. */
export interface SceneContext {
  entities: EntitySummary[];
  selectedIds: string[];
  sceneSettings: SceneSettings;
}

/** Minimal store interface needed by buildSceneContext. */
export interface SceneContextStore {
  sceneGraph: SceneGraph;
  selectedIds: Set<string>;
  ambientLight: { color: [number, number, number]; brightness: number };
  environment: {
    clearColor: [number, number, number];
    fogEnabled: boolean;
    skyboxPreset: string | null;
  };
  engineMode: string;
}

/**
 * Infer entity type from the SceneNode components list.
 */
function inferEntityType(node: SceneNode): string {
  if (node.components.includes('TerrainEnabled')) return 'terrain';
  if (node.components.includes('PointLight')) return 'point_light';
  if (node.components.includes('DirectionalLight')) return 'directional_light';
  if (node.components.includes('SpotLight')) return 'spot_light';
  if (node.components.includes('SpriteData')) return 'sprite';
  if (node.components.includes('Mesh3d')) return 'mesh';
  return 'entity';
}

/**
 * Build a structured scene context from the editor store state.
 * Used by the game modifier to provide AI with current scene information.
 */
export function buildSceneContext(state: SceneContextStore): SceneContext {
  const { sceneGraph, selectedIds, ambientLight, environment, engineMode } = state;

  const entities: EntitySummary[] = [];
  for (const node of Object.values(sceneGraph.nodes)) {
    entities.push({
      id: node.entityId,
      name: node.name,
      type: inferEntityType(node),
      components: node.components,
      visible: node.visible,
      parentId: node.parentId,
    });
  }

  const sceneSettings: SceneSettings = {
    ambientLight: {
      color: ambientLight.color,
      brightness: ambientLight.brightness,
    },
    environment: {
      clearColor: environment.clearColor,
      fogEnabled: environment.fogEnabled,
      skyboxPreset: environment.skyboxPreset,
    },
    engineMode,
  };

  return {
    entities,
    selectedIds: [...selectedIds],
    sceneSettings,
  };
}
