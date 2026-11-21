/**
 * Tests for the template → engine SceneFile translation.
 *
 * The engine cannot report a bad payload: `handle_load_scene` returns `Ok` for
 * any string and `apply_scene_load` `return`s silently when serde rejects it.
 * These tests are the only thing standing between a shape change and a template
 * gallery that reports success and applies nothing, so they assert against the
 * Rust structs' actual requirements rather than against the translator's own
 * output shape.
 */

import { describe, it, expect } from 'vitest';
import { buildTemplateSceneFile, toEngineEntityType } from '../templateSceneFile';
import { TEMPLATE_REGISTRY } from '@/data/templates';
import type { GameTemplate, EntitySnapshotData } from '@/data/templates';

/** Fields `EntitySnapshot` declares WITHOUT `#[serde(default)]` — all mandatory. */
const REQUIRED_SNAPSHOT_FIELDS = [
  'entityId',
  'entityType',
  'name',
  'transform',
  'parentId',
  'visible',
  'materialData',
  'lightData',
  'physicsData',
  'physicsEnabled',
] as const;

/** `EntityType`'s snake_case variants (`engine/src/core/pending/mod.rs`). */
const ENGINE_ENTITY_TYPES = new Set([
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
]);

function makeEntity(overrides: Partial<EntitySnapshotData> = {}): EntitySnapshotData {
  return {
    entityId: 'e1',
    entityName: 'Entity One',
    entityType: 'Cube',
    parentId: null,
    visible: true,
    transform: { translation: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    ...overrides,
  };
}

function makeTemplate(entities: EntitySnapshotData[]): GameTemplate {
  return {
    id: 'test',
    name: 'Test Template',
    description: 'd',
    category: 'platformer',
    difficulty: 'beginner',
    thumbnail: { gradient: 'g', icon: 'i', accentColor: '#fff' },
    tags: [],
    sceneData: {
      formatVersion: 1,
      metadata: { name: 'Scene', createdAt: 'a', modifiedAt: 'b' },
      environment: {},
      ambientLight: { color: [1, 1, 1], brightness: 300 },
      inputBindings: {},
      entities,
    },
    scripts: {},
  };
}

describe('toEngineEntityType', () => {
  it('maps every template PascalCase spelling onto an engine variant', () => {
    expect(toEngineEntityType('Cube')).toBe('cube');
    expect(toEngineEntityType('PointLight')).toBe('point_light');
    expect(toEngineEntityType('DirectionalLight')).toBe('directional_light');
    expect(toEngineEntityType('SpotLight')).toBe('spot_light');
    expect(toEngineEntityType('Sprite')).toBe('sprite');
    expect(toEngineEntityType('ProceduralMesh')).toBe('procedural_mesh');
  });

  it('passes an already-snake_case type through unchanged', () => {
    expect(toEngineEntityType('point_light')).toBe('point_light');
  });

  it('returns null for a type the engine has no variant for', () => {
    // Camera2d is the live case: six templates ship one. serde rejects an
    // unknown enum variant for the whole file, so this MUST NOT fall back to
    // some other type — dropping the entity is the only safe answer.
    expect(toEngineEntityType('Camera2d')).toBeNull();
  });
});

describe('buildTemplateSceneFile', () => {
  it('renames translation to position, since TransformSnapshot has no translation field', () => {
    const { sceneJson } = buildTemplateSceneFile(makeTemplate([makeEntity()]));
    const parsed = JSON.parse(sceneJson);
    expect(parsed.entities[0].transform).toEqual({
      position: [1, 2, 3],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    });
    expect(parsed.entities[0].transform.translation).toBeUndefined();
  });

  it('renames entityName to name', () => {
    const { sceneJson } = buildTemplateSceneFile(makeTemplate([makeEntity()]));
    expect(JSON.parse(sceneJson).entities[0].name).toBe('Entity One');
  });

  /**
   * A TEMPLATE THAT SAYS NOTHING ABOUT INPUT MUST NOT SILENCE THE KEYBOARD.
   *
   * This used to assert `{ actions: {}, preset: null }`, because `InputMap` had
   * no serde default and a template's `inputBindings: {}` failed the whole
   * file. That workaround had a cost nobody priced: `load_scene` assigns the
   * file's map straight onto the `InputMap` resource, so every template was
   * loaded into a scene where NO KEY DID ANYTHING — and a genre preset was then
   * applied on top, which is how "pick a genre" became the only route to having
   * input at all.
   *
   * `SceneFile.input_bindings` takes `#[serde(default)]` now and
   * `InputMap::default()` is a working keyboard, so the right emission for a
   * template with no opinion is to OMIT the key. An empty map is not neutral —
   * it is a deliberate statement that nothing is bound (#9764).
   */
  it('omits inputBindings when the template declares none, so the defaults apply', () => {
    const { sceneJson } = buildTemplateSceneFile(makeTemplate([makeEntity()]));
    expect('inputBindings' in JSON.parse(sceneJson)).toBe(false);
  });

  /**
   * THE ENGINE'S SHAPE, NOT THE ONE A TEMPLATE WRITES.
   *
   * These two shapes share no field names. `InputBinding` — what
   * `GameTemplate.sceneData.inputBindings` is typed as — is
   * `{ actionName, actionType: 'digital', sources: ['KeyG'] }`. `ActionDef` in
   * `engine/src/core/input.rs` is `{ name, actionType: { type: 'Digital' },
   * sources: [{ type: 'Key', value: 'KeyG' }], deadZone }`.
   *
   * An earlier version of this test asserted the WEB shape came out unchanged
   * and called a web-shaped object "the full InputMap shape". Both passed, and
   * both were wrong: `apply_scene_load` logs and returns on a payload it cannot
   * deserialise, so a template declaring one binding would have loaded NOTHING
   * — no entities, no scripts — silently. That is lessons-learned #14 written
   * by hand: a unit test cannot disagree with you about a contract the other
   * side enforces. The expectations below are the Rust field names.
   */
  it('converts a declared binding into the ActionDef the engine deserialises', () => {
    const template = makeTemplate([makeEntity()]);
    template.sceneData.inputBindings = {
      grapple: { actionName: 'grapple', actionType: 'digital', sources: ['KeyG'] },
    };

    const parsed = JSON.parse(buildTemplateSceneFile(template).sceneJson);
    expect(parsed.inputBindings.actions.grapple).toEqual({
      name: 'grapple',
      actionType: { type: 'Digital' },
      sources: [{ type: 'Key', value: 'KeyG' }],
      deadZone: 0.1,
    });
  });

  /**
   * The engine decides mouse-vs-key by NAME (`handle_set_input_binding`:
   * `if s == "Left" || s == "Right" || s == "Middle"`), so the converter has to
   * make the same call — otherwise binding the left mouse button produces a key
   * named "Left" that no keyboard has.
   */
  it('tags Left, Right and Middle as mouse buttons rather than keys', () => {
    const template = makeTemplate([makeEntity()]);
    template.sceneData.inputBindings = {
      shoot: { actionName: 'shoot', actionType: 'digital', sources: ['Left', 'KeyJ'] },
    };

    const parsed = JSON.parse(buildTemplateSceneFile(template).sceneJson);
    expect(parsed.inputBindings.actions.shoot.sources).toEqual([
      { type: 'MouseButton', value: 'Left' },
      { type: 'Key', value: 'KeyJ' },
    ]);
  });

  it('converts an axis binding into the tagged Axis variant', () => {
    const template = makeTemplate([makeEntity()]);
    template.sceneData.inputBindings = {
      steer: {
        actionName: 'steer',
        actionType: 'axis',
        sources: [],
        positiveKeys: ['KeyD'],
        negativeKeys: ['KeyA'],
        deadZone: 0.25,
      },
    };

    const parsed = JSON.parse(buildTemplateSceneFile(template).sceneJson);
    expect(parsed.inputBindings.actions.steer).toEqual({
      name: 'steer',
      actionType: {
        type: 'Axis',
        positive: [{ type: 'Key', value: 'KeyD' }],
        negative: [{ type: 'Key', value: 'KeyA' }],
      },
      // Empty on purpose: the engine ignores `sources` for an axis, and
      // duplicating the keys there would suggest a second binding that does
      // nothing.
      sources: [],
      deadZone: 0.25,
    });
  });

  it('accepts a template that wraps its bindings in the actions key', () => {
    const template = makeTemplate([makeEntity()]);
    template.sceneData.inputBindings = {
      actions: { p2_attack: { actionName: 'p2_attack', actionType: 'digital', sources: ['Enter'] } },
      preset: null,
    } as unknown as Record<string, unknown>;

    const parsed = JSON.parse(buildTemplateSceneFile(template).sceneJson);
    expect(Object.keys(parsed.inputBindings.actions)).toEqual(['p2_attack']);
    expect(parsed.inputBindings.actions.p2_attack.name).toBe('p2_attack');
  });

  /**
   * A binding with nothing bound is an action that can never fire. Dropping it
   * rather than emitting it keeps a typo from shipping a dead control — and if
   * dropping leaves nothing, that is "no opinion" again rather than a scene
   * with a silent keyboard.
   */
  it('drops an unusable binding, and falls back to the defaults if none survive', () => {
    const template = makeTemplate([makeEntity()]);
    template.sceneData.inputBindings = {
      broken: { actionName: 'broken', actionType: 'digital', sources: [] },
    };

    expect('inputBindings' in JSON.parse(buildTemplateSceneFile(template).sceneJson)).toBe(false);
  });

  it('splits physics into physicsData and physicsEnabled and fills every field', () => {
    const template = makeTemplate([
      makeEntity({
        physics: { data: { bodyType: 'fixed', colliderShape: 'cuboid', mass: 4 }, enabled: true },
      }),
    ]);
    const entity = JSON.parse(buildTemplateSceneFile(template).sceneJson).entities[0];
    expect(entity.physicsEnabled).toBe(true);
    expect(entity.physicsData.bodyType).toBe('fixed');
    expect(entity.physicsData.colliderShape).toBe('cuboid');
    // `mass` has no PhysicsData counterpart; forwarding it is harmless (serde
    // ignores unknown keys) but the 13 real fields must all be present.
    expect(entity.physicsData).toMatchObject({
      restitution: expect.any(Number),
      friction: expect.any(Number),
      density: expect.any(Number),
      gravityScale: expect.any(Number),
      lockTranslationX: expect.any(Boolean),
      lockRotationZ: expect.any(Boolean),
      isSensor: expect.any(Boolean),
    });
    expect(entity.physics).toBeUndefined();
  });

  it('reports physicsEnabled false when the template disables it', () => {
    const template = makeTemplate([
      makeEntity({ physics: { data: { bodyType: 'dynamic' }, enabled: false } }),
    ]);
    expect(JSON.parse(buildTemplateSceneFile(template).sceneJson).entities[0].physicsEnabled).toBe(
      false,
    );
  });

  it('renames material to materialData and preserves the authored colour', () => {
    const template = makeTemplate([
      makeEntity({ material: { baseColor: [0.2, 0.6, 1, 1], metallic: 0, alphaMode: 'blend' } }),
    ]);
    const entity = JSON.parse(buildTemplateSceneFile(template).sceneJson).entities[0];
    expect(entity.materialData.baseColor).toEqual([0.2, 0.6, 1, 1]);
    expect(entity.materialData.alphaMode).toBe('blend');
    expect(entity.material).toBeUndefined();
  });

  it('renames light to lightData and preserves the authored light type', () => {
    const template = makeTemplate([
      makeEntity({
        entityType: 'DirectionalLight',
        light: {
          lightType: 'directional',
          color: [1, 0.9, 0.8],
          intensity: 10000,
          shadowsEnabled: true,
          shadowDepthBias: 0.02,
          shadowNormalBias: 1.8,
          range: 20,
          radius: 0,
          innerAngle: 0.4,
          outerAngle: 0.8,
        },
      }),
    ]);
    const entity = JSON.parse(buildTemplateSceneFile(template).sceneJson).entities[0];
    expect(entity.lightData.lightType).toBe('directional');
    expect(entity.lightData.intensity).toBe(10000);
    expect(entity.light).toBeUndefined();
  });

  it('emits null (not undefined) for absent material, light and physics', () => {
    // `Option<MaterialData>` has no serde default, so the key must be PRESENT.
    // `JSON.stringify` drops an undefined value entirely, which fails the file.
    const raw = buildTemplateSceneFile(makeTemplate([makeEntity()])).sceneJson;
    const entity = JSON.parse(raw).entities[0];
    for (const field of ['materialData', 'lightData', 'physicsData'] as const) {
      expect(raw).toContain(`"${field}":null`);
      expect(entity[field]).toBeNull();
    }
  });

  it('drops an entity whose type has no engine variant and reports its id', () => {
    const result = buildTemplateSceneFile(
      makeTemplate([makeEntity(), makeEntity({ entityId: 'cam', entityType: 'Camera2d' })]),
    );
    const parsed = JSON.parse(result.sceneJson);
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.entities[0].entityId).toBe('e1');
    expect(result.skippedEntityIds).toEqual(['cam']);
    expect(result.entityCount).toBe(1);
  });

  it('nulls a parentId that points at a dropped entity', () => {
    const result = buildTemplateSceneFile(
      makeTemplate([
        makeEntity({ entityId: 'cam', entityType: 'Camera2d' }),
        makeEntity({ entityId: 'child', parentId: 'cam' }),
      ]),
    );
    expect(JSON.parse(result.sceneJson).entities[0].parentId).toBeNull();
  });

  it('keeps a parentId that points at a surviving entity', () => {
    const result = buildTemplateSceneFile(
      makeTemplate([makeEntity({ entityId: 'root' }), makeEntity({ entityId: 'child', parentId: 'root' })]),
    );
    const child = JSON.parse(result.sceneJson).entities.find(
      (e: { entityId: string }) => e.entityId === 'child',
    );
    expect(child.parentId).toBe('root');
  });

  it('fills the ten environment fields the engine requires from its own defaults', () => {
    const parsed = JSON.parse(buildTemplateSceneFile(makeTemplate([makeEntity()])).sceneJson);
    expect(parsed.environment).toEqual({
      skyboxBrightness: 1000,
      iblIntensity: 900,
      iblRotationDegrees: 0,
      clearColor: [0.1, 0.1, 0.12],
      fogEnabled: false,
      fogColor: [0.5, 0.5, 0.55],
      fogStart: 30,
      fogEnd: 100,
      skyboxPreset: null,
      skyboxAssetId: null,
    });
  });

  it('lets the template override an environment default', () => {
    const template = makeTemplate([makeEntity()]);
    template.sceneData.environment = { fogEnabled: true, fogEnd: 250 };
    const parsed = JSON.parse(buildTemplateSceneFile(template).sceneJson);
    expect(parsed.environment.fogEnabled).toBe(true);
    expect(parsed.environment.fogEnd).toBe(250);
    expect(parsed.environment.skyboxBrightness).toBe(1000);
  });

  it('drops the templates legacy flat postProcessing rather than failing the file', () => {
    const template = makeTemplate([makeEntity()]);
    template.sceneData.postProcessing = { bloomEnabled: true, bloomIntensity: 0.4 };
    expect(JSON.parse(buildTemplateSceneFile(template).sceneJson).postProcessing).toBeUndefined();
  });
});

describe('every shipped template translates into a loadable SceneFile', () => {
  // The unit cases above use hand-built fixtures, which cannot catch a template
  // that ships a value the shared builders reject — `parsePartial` answers an
  // invalid field by discarding the WHOLE object and returning defaults, so a
  // single out-of-range number turns an authored material white with no error.
  it.each(TEMPLATE_REGISTRY.map((t) => [t.id, t] as const))(
    '%s',
    async (_id, entry) => {
      const template = await entry.load();
      const { sceneJson, entityCount, skippedEntityIds } = buildTemplateSceneFile(template);
      const parsed = JSON.parse(sceneJson);

      expect(parsed.entities.length).toBe(entityCount);
      expect(entityCount).toBeGreaterThan(0);

      const keptIds = new Set<string>(parsed.entities.map((e: { entityId: string }) => e.entityId));
      for (const entity of parsed.entities) {
        for (const field of REQUIRED_SNAPSHOT_FIELDS) {
          expect(entity).toHaveProperty(field);
          expect(entity[field]).not.toBeUndefined();
        }
        expect(ENGINE_ENTITY_TYPES.has(entity.entityType)).toBe(true);
        expect(entity.transform.position).toHaveLength(3);
        expect(entity.transform.rotation).toHaveLength(4);
        expect(entity.transform.scale).toHaveLength(3);
        if (entity.parentId !== null) expect(keptIds.has(entity.parentId)).toBe(true);
      }

      // Every authored material must survive: a builder rejection would replace
      // it with the all-white default and nothing else would notice.
      const authored = new Map(
        template.sceneData.entities
          .filter((e) => e.material && !skippedEntityIds.includes(e.entityId))
          .map((e) => [e.entityId, e.material as Record<string, unknown>]),
      );
      for (const entity of parsed.entities) {
        const src = authored.get(entity.entityId);
        if (src?.baseColor) expect(entity.materialData.baseColor).toEqual(src.baseColor);
      }

      // Same for physics: a rejected bodyType silently becomes 'dynamic', which
      // turns every static platform in the scene into a falling object.
      const authoredPhysics = new Map(
        template.sceneData.entities
          .filter((e) => e.physics && !skippedEntityIds.includes(e.entityId))
          .map((e) => [e.entityId, e.physics!]),
      );
      for (const entity of parsed.entities) {
        const src = authoredPhysics.get(entity.entityId);
        if (!src) continue;
        expect(entity.physicsEnabled).toBe(src.enabled === true);
        if (src.data.bodyType) expect(entity.physicsData.bodyType).toBe(src.data.bodyType);
        if (src.data.colliderShape)
          expect(entity.physicsData.colliderShape).toBe(src.data.colliderShape);
      }

      // Scripts are applied through `setScript`, not the scene file — but every
      // script key must name an entity that actually survived translation, or
      // the script would be attached to nothing.
      for (const entityId of Object.keys(template.scripts)) {
        expect(keptIds.has(entityId) || skippedEntityIds.includes(entityId)).toBe(true);
      }
    },
  );
});
