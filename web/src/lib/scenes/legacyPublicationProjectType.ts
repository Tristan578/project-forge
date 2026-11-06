/**
 * A STOPGAP for 2D games published before scenes recorded their project type
 * (#10368). Read only by `/play`.
 *
 * Since #10227 a scene states its dimension as `metadata.projectType`, and the
 * engine applies it on `load_scene`. Every game published before that change
 * states nothing, so on `/play` the engine stays at its 3D default, no 2D
 * camera exists, and a 2D game renders a blank canvas until its creator
 * republishes. There is no stored type to read instead (#10358 chose a
 * scene-level field only), so for those publications the type is GUESSED from
 * what the scene contains.
 *
 * `docs/features/save-load.md` says the format never guesses the type from the
 * entities, and this does not change that: the editor, saves and the engine
 * still never guess. This module is confined to the published-game player, is
 * reported every time it fires, and is meant to be retired once those
 * publications carry the key (a backfill of the stored snapshots, or creators
 * republishing).
 *
 * THE RULE IS ONE-SIDED ON PURPOSE. A wrong `'2d'` would put a published 3D
 * game behind an orthographic camera, which is worse than today's behaviour;
 * a wrong `null` leaves a 2D game exactly as it is today. So the answer is
 * `'2d'` only when every entity is either unmistakably 2D content or a light
 * (lights carry no dimension of their own), at least one entity is 2D, and no
 * entity carries 3D-only content. Anything else — no entities, an unknown
 * shape, a single mesh with no 2D marker — is `null`.
 *
 * Kept a leaf (no store, no hook imports) for the same reason as
 * `sceneProjectType.ts`: `/play` is the public bundle.
 */
import { SCENE_PROJECT_TYPE_KEY, type SceneProjectType } from './sceneProjectType';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Entity types that carry no dimension: a light lights a 2D scene and a 3D one alike. */
export const NEUTRAL_ENTITY_TYPES: ReadonlySet<string> = new Set(['point_light', 'directional_light', 'spot_light']);

/**
 * Entity types that exist only in a 3D scene. Spelled as the engine
 * serializes `EntityType` (`snake_case`, `engine/src/core/pending/mod.rs`).
 */
export const THREE_D_ONLY_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'terrain',
  'csg_result',
  'procedural_mesh',
  'gltf_model',
  'gltf_mesh',
]);

/** `EntitySnapshot` fields (camelCase, as saved) that only a 3D entity carries. */
export const THREE_D_ONLY_FIELDS = ['terrainData', 'terrainMeshData', 'csgMeshData', 'proceduralMeshData', 'assetRef'] as const;

/** `EntitySnapshot` fields that only a 2D entity carries. */
export const TWO_D_FIELDS = ['spriteData', 'tilemapData', 'skeleton2dData'] as const;

function hasValue(entity: Record<string, unknown>, field: string): boolean {
  const value = entity[field];
  return value !== undefined && value !== null;
}

function hasThreeDOnlyContent(entity: Record<string, unknown>): boolean {
  const entityType = typeof entity.entityType === 'string' ? entity.entityType : null;
  if (entityType !== null && THREE_D_ONLY_ENTITY_TYPES.has(entityType)) return true;
  return THREE_D_ONLY_FIELDS.some((field) => hasValue(entity, field));
}

/**
 * Whether any entity in a scene carries content that only a 3D scene can hold
 * (the same vocabulary the guess refuses on). Used by the stored-snapshot
 * backfill (#10368) to refuse a stated `'2d'` that the scene contradicts.
 * @param sceneData A parsed, untrusted scene object.
 * @returns True only when the entity list exists and some entity is 3D-only.
 */
export function sceneHasThreeDOnlyContent(sceneData: unknown): boolean {
  if (!isRecord(sceneData) || !Array.isArray(sceneData.entities)) return false;
  const entities: unknown[] = sceneData.entities;
  // Indexed, not `.some`: a callback form skips an array hole, and a hole must
  // not hide the entity after it.
  for (let i = 0; i < entities.length; i += 1) {
    const entity = entities[i];
    if (isRecord(entity) && hasThreeDOnlyContent(entity)) return true;
  }
  return false;
}

type EntityDimension = '2d' | 'neutral' | 'not-2d';

function classifyEntity(entity: unknown): EntityDimension {
  if (!isRecord(entity)) return 'not-2d';
  const entityType = typeof entity.entityType === 'string' ? entity.entityType : null;
  if (hasThreeDOnlyContent(entity)) return 'not-2d';
  if (
    entityType === 'sprite' ||
    TWO_D_FIELDS.some((field) => hasValue(entity, field)) ||
    entity.physics2dEnabled === true
  ) {
    return '2d';
  }
  if (entityType !== null && NEUTRAL_ENTITY_TYPES.has(entityType)) return 'neutral';
  return 'not-2d';
}

/**
 * Guess the dimension of a published scene that states none.
 * @param sceneData A parsed, untrusted publication snapshot.
 * @returns `'2d'` only for a key-less scene whose every entity is 2D content
 *   or a light, with at least one 2D entity and nothing 3D-only; `null` for
 *   everything else, including any scene that states a type (or a value the
 *   engine will refuse) — the stated value always wins and is not this
 *   module's business.
 */
export function guessLegacyPublicationProjectType(sceneData: unknown): SceneProjectType | null {
  if (!isRecord(sceneData) || !isRecord(sceneData.metadata)) return null;
  const stated = sceneData.metadata[SCENE_PROJECT_TYPE_KEY];
  if (stated !== undefined && stated !== null) return null;
  const entities = sceneData.entities;
  if (!Array.isArray(entities) || entities.length === 0) return null;
  let twoD = 0;
  for (const entity of entities) {
    const dimension = classifyEntity(entity);
    if (dimension === 'not-2d') return null;
    if (dimension === '2d') twoD += 1;
  }
  return twoD > 0 ? '2d' : null;
}
