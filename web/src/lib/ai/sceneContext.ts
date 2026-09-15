/**
 * Scene context builder for AI game modification.
 * Extracts a minimal, structured representation of the current scene
 * that can be included in AI prompts for modification planning.
 */

import type { SceneGraph, AmbientLightData, EnvironmentData, EngineMode } from '@/stores/slices/types';
import { inferEntityType } from '@/lib/chat/handlers/helpers';

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
  ambientLight: AmbientLightData;
  environment: Pick<EnvironmentData, 'clearColor' | 'fogEnabled' | 'skyboxPreset'>;
  engineMode: EngineMode;
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
  ambientLight: AmbientLightData;
  environment: Pick<EnvironmentData, 'clearColor' | 'fogEnabled' | 'skyboxPreset'>;
  engineMode: EngineMode;
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
