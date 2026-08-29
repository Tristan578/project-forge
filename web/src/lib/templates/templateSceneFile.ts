/**
 * Translate a `GameTemplate` into the `.forge` scene JSON the engine's
 * `load_scene` command accepts.
 *
 * The template files and the engine's `SceneFile` are NOT the same format, and
 * the difference is silent: `handle_load_scene` only checks that `payload.json`
 * is a string and returns `Ok`, while the actual deserialization happens a frame
 * later in `apply_scene_load`, which `return`s without emitting anything when
 * serde rejects the payload. Handing the engine `template.sceneData` verbatim
 * therefore looks like success and applies nothing. The divergences:
 *
 * | Template (`SceneFileData`)      | Engine (`SceneFile`)                    |
 * |---------------------------------|-----------------------------------------|
 * | `transform.translation`         | `transform.position`                    |
 * | `entityName`                    | `name`                                  |
 * | `entityType: 'PointLight'`      | `entityType: 'point_light'` (snake_case)|
 * | `material`                      | `materialData` (all 25 fields required) |
 * | `light`                         | `lightData` (all 10 fields required)    |
 * | `physics: { data, enabled }`    | `physicsData` + `physicsEnabled`        |
 * | `inputBindings: {}`             | `{ actions, preset }` — both required   |
 *
 * `EntitySnapshot`'s first ten fields carry no `#[serde(default)]`, so a missing
 * `materialData` or `physicsEnabled` fails the whole scene, not just one entity.
 *
 * What this module deliberately does NOT carry:
 * - **scripts** — `ScriptData` inside the snapshot would reach the engine but
 *   never `scriptSlice.allScripts`, which is the map the JS script worker runs
 *   from (the engine only emits `SCRIPT_CHANGED` for the selected entity). They
 *   go through `setScript` after the load lands so both sides hold them.
 * - **game components** — same reason for `gameSlice.allGameComponents`; they go
 *   through `addGameComponent`, which also owns the store↔engine name mapping.
 * - **postProcessing** — the templates use a flat legacy shape (`bloomEnabled`,
 *   `bloomIntensity`, …) while `PostProcessingSettings` is nested (`bloom: {…}`).
 *   Forwarding it fails the whole file, so it is dropped and the engine keeps
 *   its defaults. Converting the two shapes is out of scope here.
 */

import type { GameTemplate, EntitySnapshotData } from '@/data/templates';
import {
  buildMaterialFromPartial,
  buildLightFromPartial,
  buildPhysicsFromPartial,
} from '@/lib/chat/handlers/helpers';

/**
 * Template `entityType` spelling → the engine's snake_case `EntityType`.
 *
 * Mirrors `EntityType::from_str` in `engine/src/core/pending/mod.rs`. A template
 * type with no engine counterpart (`Camera2d`) is absent on purpose: serde
 * rejects an unknown variant for the WHOLE file, so one unmappable entity would
 * silently discard the other 27. Unmappable entities are dropped and reported.
 */
const ENGINE_ENTITY_TYPES = [
  'cube',
  'sphere',
  'plane',
  'cylinder',
  'cone',
  'torus',
  'capsule',
  'csg_result',
  'terrain',
  'procedural_mesh',
  'point_light',
  'directional_light',
  'spot_light',
  'gltf_model',
  'gltf_mesh',
  'sprite',
] as const;

const ENGINE_TYPE_BY_TEMPLATE_TYPE: Readonly<Record<string, string>> = {
  Cube: 'cube',
  Sphere: 'sphere',
  Plane: 'plane',
  Cylinder: 'cylinder',
  Cone: 'cone',
  Torus: 'torus',
  Capsule: 'capsule',
  CsgResult: 'csg_result',
  Terrain: 'terrain',
  ProceduralMesh: 'procedural_mesh',
  PointLight: 'point_light',
  DirectionalLight: 'directional_light',
  SpotLight: 'spot_light',
  GltfModel: 'gltf_model',
  GltfMesh: 'gltf_mesh',
  Sprite: 'sprite',
};

/** Resolve a template `entityType` to the engine spelling, or `null` if it has none. */
export function toEngineEntityType(templateType: string): string | null {
  if ((ENGINE_ENTITY_TYPES as readonly string[]).includes(templateType)) return templateType;
  return ENGINE_TYPE_BY_TEMPLATE_TYPE[templateType] ?? null;
}

/** Defaults mirroring `EnvironmentSettings::default()` in `engine/src/core/environment.rs`. */
const ENGINE_ENVIRONMENT_DEFAULTS = {
  skyboxBrightness: 1000.0,
  iblIntensity: 900.0,
  iblRotationDegrees: 0.0,
  clearColor: [0.1, 0.1, 0.12],
  fogEnabled: false,
  fogColor: [0.5, 0.5, 0.55],
  fogStart: 30.0,
  fogEnd: 100.0,
  skyboxPreset: null,
  skyboxAssetId: null,
} as const;

/** Defaults mirroring `AmbientLightData::default()` in `engine/src/core/scene_file.rs`. */
const ENGINE_AMBIENT_DEFAULTS = { color: [1.0, 1.0, 1.0], brightness: 300.0 } as const;

export interface TemplateSceneFile {
  /** Serialized `SceneFile` ready for `load_scene`'s `json` field. */
  sceneJson: string;
  /** Entities the engine will spawn — i.e. after unmappable ones are dropped. */
  entityCount: number;
  /** Entity ids dropped because their `entityType` has no engine counterpart. */
  skippedEntityIds: string[];
}

function buildTransform(entity: EntitySnapshotData) {
  const t = entity.transform;
  return {
    position: t?.translation ?? [0, 0, 0],
    rotation: t?.rotation ?? [0, 0, 0, 1],
    scale: t?.scale ?? [1, 1, 1],
  };
}

/**
 * Build the engine `SceneFile` JSON for a template.
 *
 * Pure and synchronous: no engine, no WASM, no network. Every field the engine
 * requires is emitted unconditionally, so a template that omits one still
 * deserializes.
 */
export function buildTemplateSceneFile(template: GameTemplate): TemplateSceneFile {
  const skippedEntityIds: string[] = [];
  const source = template.sceneData;

  // Two passes: the first decides who survives, so the second can null out a
  // `parentId` pointing at a dropped entity. `restore_hierarchy` looks the
  // parent up by id and a dangling reference would leave the child unparented
  // anyway — doing it here makes the outcome the same on both sides.
  const kept = new Map<string, { entity: EntitySnapshotData; engineType: string }>();
  for (const entity of source.entities ?? []) {
    const engineType = toEngineEntityType(entity.entityType);
    if (engineType === null) {
      skippedEntityIds.push(entity.entityId);
      continue;
    }
    kept.set(entity.entityId, { entity, engineType });
  }

  const entities = [...kept.values()].map(({ entity, engineType }) => ({
    entityId: entity.entityId,
    entityType: engineType,
    name: entity.entityName,
    transform: buildTransform(entity),
    parentId: entity.parentId !== null && kept.has(entity.parentId) ? entity.parentId : null,
    visible: entity.visible !== false,
    materialData: entity.material ? buildMaterialFromPartial(entity.material) : null,
    lightData: entity.light
      ? buildLightFromPartial(entity.light as unknown as Record<string, unknown>)
      : null,
    physicsData: entity.physics ? buildPhysicsFromPartial(entity.physics.data) : null,
    physicsEnabled: entity.physics?.enabled === true,
  }));

  const sceneFile = {
    formatVersion: source.formatVersion ?? 1,
    metadata: {
      name: source.metadata?.name ?? template.name,
      createdAt: source.metadata?.createdAt ?? '',
      modifiedAt: source.metadata?.modifiedAt ?? '',
    },
    environment: { ...ENGINE_ENVIRONMENT_DEFAULTS, ...(source.environment ?? {}) },
    ambientLight: { ...ENGINE_AMBIENT_DEFAULTS, ...(source.ambientLight ?? {}) },
    // `InputMap` requires both fields; the templates ship `{}`, which fails the
    // whole file. The template's own preset is applied separately, through
    // `setInputPreset`, so the engine and `scriptSlice.inputPreset` agree.
    inputBindings: { actions: {}, preset: null },
    assets: source.assets ?? {},
    entities,
  };

  return { sceneJson: JSON.stringify(sceneFile), entityCount: entities.length, skippedEntityIds };
}
