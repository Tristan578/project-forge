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
import { buildStoreComponent } from '@/lib/engine/gameComponentWire';
import type { GameComponentData } from '@/stores/slices/types';

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

/** The `InputMap` shape the engine deserialises from a scene file. */
interface EngineInputBindings {
  actions: Record<string, EngineActionDef>;
  preset: string | null;
}

/**
 * `ActionDef` as `engine/src/core/input.rs` deserialises it.
 *
 * THIS IS NOT THE SHAPE A TEMPLATE WRITES, and conflating the two is a silent
 * total failure rather than a partial one. `InputBinding` — what
 * `GameTemplate.sceneData.inputBindings` is typed as, and what the editor's
 * store holds — is `{ actionName, actionType: 'digital', sources: ['KeyG'] }`.
 * The engine wants `{ name, actionType: { type: 'Digital' }, sources: [{ type:
 * 'Key', value: 'KeyG' }], deadZone }`: different key for the name, an
 * internally-tagged enum for the type, and tagged enums for the sources.
 *
 * Passing the web shape through unconverted fails `SceneFile` deserialisation,
 * and `apply_scene_load` logs and returns on a payload it cannot read — so the
 * ENTIRE template loads nothing, silently, because one binding was declared.
 * The engine's own converter is `handle_set_input_binding`
 * (`core/commands/transform.rs`); this mirrors it, and
 * `templateSceneFile.test.ts` pins the output against the Rust field names
 * rather than against what this file happens to emit.
 */
interface EngineActionDef {
  name: string;
  actionType: { type: 'Digital' } | { type: 'Axis'; positive: EngineSource[]; negative: EngineSource[] };
  sources: EngineSource[];
  deadZone: number;
}

type EngineSource = { type: 'Key'; value: string } | { type: 'MouseButton'; value: string };

/** The three names `handle_set_input_binding` treats as mouse buttons. */
const MOUSE_BUTTONS = new Set(['Left', 'Right', 'Middle']);

/**
 * One key code as the engine's tagged `InputSource`.
 *
 * The engine decides mouse-vs-key by NAME, not by a separate field
 * (`transform.rs`: `if s == "Left" || s == "Right" || s == "Middle"`), so this
 * has to make the same call or a template binding the left mouse button gets a
 * key named "Left" that no keyboard has.
 */
function toEngineSource(code: string): EngineSource {
  return MOUSE_BUTTONS.has(code)
    ? { type: 'MouseButton', value: code }
    : { type: 'Key', value: code };
}

/** One `InputBinding` from a template or the store, as the engine's `ActionDef`. */
function toEngineActionDef(name: string, binding: Record<string, unknown>): EngineActionDef | null {
  const actionName = typeof binding.actionName === 'string' && binding.actionName !== ''
    ? binding.actionName
    : name;
  const sources = Array.isArray(binding.sources)
    ? binding.sources.filter((v): v is string => typeof v === 'string')
    : [];
  const positive = Array.isArray(binding.positiveKeys)
    ? binding.positiveKeys.filter((v): v is string => typeof v === 'string')
    : [];
  const negative = Array.isArray(binding.negativeKeys)
    ? binding.negativeKeys.filter((v): v is string => typeof v === 'string')
    : [];
  const deadZone = typeof binding.deadZone === 'number' && Number.isFinite(binding.deadZone)
    ? binding.deadZone
    : 0.1;

  if (binding.actionType === 'axis') {
    // An axis with neither direction bound is an action that can never fire.
    // Refusing it here names the template in the failure; letting it through
    // ships a control the creator will find dead in play.
    if (positive.length === 0 && negative.length === 0) return null;
    return {
      name: actionName,
      actionType: {
        type: 'Axis',
        positive: positive.map(toEngineSource),
        negative: negative.map(toEngineSource),
      },
      // Ignored for an axis by the engine, and sent empty rather than
      // duplicated so nothing suggests a second binding that does nothing.
      sources: [],
      deadZone,
    };
  }

  if (sources.length === 0) return null;
  return {
    name: actionName,
    actionType: { type: 'Digital' },
    sources: sources.map(toEngineSource),
    deadZone,
  };
}

/**
 * A template's declared actions, or `undefined` to mean "no opinion".
 *
 * THE DISTINCTION BETWEEN "NONE" AND "NO OPINION" IS THE POINT. `load_scene`
 * assigns the file's `input_bindings` straight onto the `InputMap` resource, so
 * a scene that declares `{ actions: {}, preset: null }` is not neutral — it is
 * a game in which no key does anything, and it silently overwrites the working
 * default a new scene now starts with.
 *
 * So a template that says nothing (`{}`, which is what most of them ship) gets
 * `undefined`, and the caller omits the field entirely rather than sending an
 * empty map. `serde` then leaves the engine's own default in place.
 *
 * THERE IS NO WAY HERE TO SAY "BIND NOTHING", and that is deliberate rather
 * than an oversight. An earlier version of this comment claimed a template
 * could express it by writing `actions: {}`, which the code then treated
 * identically to `{}` — a documented escape hatch that silently did the
 * opposite. `load_scene` normalises an empty map to the defaults anyway, for
 * the sake of every project already saved with the empty one, so a template
 * asking for silence could not get it even if this function passed it on. A
 * creator who wants nothing bound removes the bindings in the editor, on a
 * scene they can see.
 */
function buildInputBindings(declared: unknown): EngineInputBindings | undefined {
  if (declared === null || typeof declared !== 'object') return undefined;
  const source = declared as Record<string, unknown>;

  // The legacy shape: a bare `Record<actionName, InputBinding>` with no
  // `actions` wrapper, which is what `GameTemplate.sceneData.inputBindings` is
  // typed as. An empty one is the "no opinion" case above.
  const actions =
    source.actions !== undefined && source.actions !== null && typeof source.actions === 'object'
      ? (source.actions as Record<string, unknown>)
      : source;

  if (Object.keys(actions).length === 0) return undefined;

  // CONVERTED, not forwarded. See `EngineActionDef` above: the shape a template
  // writes and the shape the engine reads share no field names, and sending the
  // wrong one fails the whole scene file rather than one binding.
  const converted: Record<string, EngineActionDef> = {};
  for (const [name, binding] of Object.entries(actions)) {
    if (binding === null || typeof binding !== 'object') continue;
    const def = toEngineActionDef(name, binding as Record<string, unknown>);
    if (def !== null) converted[name] = def;
  }

  // Every declared binding was unusable. That is "no opinion" again rather than
  // "bind nothing": shipping an empty map here would silence the keyboard on the
  // strength of a typo.
  if (Object.keys(converted).length === 0) return undefined;

  const preset = typeof source.preset === 'string' ? source.preset : null;
  return { actions: converted, preset };
}

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
    // A TEMPLATE'S OWN ACTIONS, when it declares any.
    //
    // This used to be the literal `{ actions: {}, preset: null }` — every
    // template's bindings thrown away on the way in, whatever it had written.
    // The scene format has always carried a full `InputMap`, and the engine has
    // always persisted one, so the only thing standing between a creator and
    // their own control scheme was this line. It meant shipped content could
    // speak nothing but the four genre presets, and it is why a two-player
    // game had no way to give the second player a key.
    //
    // `{}` (which is what most templates still ship) is not an empty control
    // scheme — it is "no opinion", and it must fall through to the engine's own
    // default rather than blanking the map. That distinction is the whole fix:
    // an empty `actions` here would hand the engine a scene where no key does
    // anything, which is what a new project used to get.
    inputBindings: buildInputBindings(source.inputBindings),
    assets: source.assets ?? {},
    entities,
  };

  return { sceneJson: JSON.stringify(sceneFile), entityCount: entities.length, skippedEntityIds };
}

/**
 * Shape a template entity's `gameComponents` into complete store components.
 *
 * Templates use two spellings for the same thing — the 3D templates put the
 * fields directly on the entry (`{ type: 'health', maxHp: 3 }`) while the 2D
 * ones nest them under the type name (`{ type: 'health', health: { maxHp: 3 } }`).
 * Both are partial: `HealthData` has six fields and no template writes all six.
 * `buildStoreComponent` fills the rest with the same values the Rust `Default`
 * impls use, so the store's copy and the engine's copy are the same component.
 *
 * An entry whose `type` names no known component is dropped — dispatching it
 * would be rejected by `build_game_component` with nothing applied.
 */
export function buildTemplateGameComponents(entity: EntitySnapshotData): GameComponentData[] {
  const components: GameComponentData[] = [];
  for (const entry of entity.gameComponents ?? []) {
    const nested = entry[entry.type];
    const props =
      nested !== null && typeof nested === 'object' && !Array.isArray(nested)
        ? (nested as Record<string, unknown>)
        : (Object.fromEntries(
            Object.entries(entry).filter(([key]) => key !== 'type'),
          ) as Record<string, unknown>);
    const built = buildStoreComponent(entry.type, props);
    if (built) components.push(built);
  }
  return components;
}
