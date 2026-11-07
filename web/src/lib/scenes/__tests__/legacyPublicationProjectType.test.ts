/**
 * @vitest-environment node
 *
 * The `/play` stopgap for 2D games published before scenes recorded their
 * project type (#10368). One-sided by design: `'2d'` only when the scene is
 * unmistakably 2D, `null` (today's behaviour) for anything ambiguous, because
 * a wrong `'2d'` would put a published 3D game behind a 2D camera.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  guessLegacyPublicationProjectType,
  NEUTRAL_ENTITY_TYPES,
  sceneHasThreeDOnlyContent,
  THREE_D_ONLY_ENTITY_TYPES,
  THREE_D_ONLY_FIELDS,
  TWO_D_FIELDS,
} from '../legacyPublicationProjectType';

const ENGINE = resolve(__dirname, '../../../../../engine/src/core');

function legacyScene(entities: unknown[]) {
  return { formatVersion: 3, metadata: { name: 'Published' }, entities };
}

const sprite = (id: string) => ({ entityId: id, entityType: 'sprite', spriteData: { textureAssetId: null } });
const light = { entityId: 'sun', entityType: 'directional_light', lightData: {} };
/** The #10354 reference platformer's shape: cube meshes simulated by 2D physics. */
const physics2dCube = (id: string) => ({ entityId: id, entityType: 'cube', physics2dEnabled: true, physics2dData: {} });
const meshCube = { entityId: 'box', entityType: 'cube', physicsEnabled: true, physicsData: {} };

describe('guessLegacyPublicationProjectType (#10368)', () => {
  it('reads a key-less scene of sprites as 2d', () => {
    expect(guessLegacyPublicationProjectType(legacyScene([sprite('player'), sprite('ground')]))).toBe('2d');
  });

  it('reads 2D-physics entities as 2d, whatever mesh draws them', () => {
    expect(guessLegacyPublicationProjectType(legacyScene([physics2dCube('player'), physics2dCube('ledge')]))).toBe('2d');
  });

  it('counts a tilemap and a 2D skeleton as 2d content', () => {
    expect(guessLegacyPublicationProjectType(legacyScene([{ entityId: 't', entityType: 'cube', tilemapData: {} }]))).toBe('2d');
    expect(guessLegacyPublicationProjectType(legacyScene([{ entityId: 's', entityType: 'cube', skeleton2dData: {} }]))).toBe('2d');
  });

  it('lets lights ride along without deciding anything', () => {
    expect(guessLegacyPublicationProjectType(legacyScene([light, sprite('player')]))).toBe('2d');
    expect(guessLegacyPublicationProjectType(legacyScene([light]))).toBeNull();
  });

  it('stays 3D (null) for one mesh with no 2D marker among sprites', () => {
    expect(guessLegacyPublicationProjectType(legacyScene([sprite('player'), meshCube]))).toBeNull();
  });

  it.each([
    ['terrain', { entityId: 'land', entityType: 'terrain', terrainData: {} }],
    ['a glTF model', { entityId: 'm', entityType: 'gltf_model' }],
    ['a sprite carrying CSG geometry', { ...sprite('odd'), csgMeshData: {} }],
    ['a sprite carrying an imported asset', { ...sprite('odd'), assetRef: { assetId: 'x' } }],
  ])('stays 3D (null) when the scene holds %s', (_label, entity) => {
    expect(guessLegacyPublicationProjectType(legacyScene([sprite('player'), entity]))).toBeNull();
  });

  it('does not read disabled 2D physics as a 2D marker', () => {
    const disabled = { entityId: 'p', entityType: 'cube', physics2dEnabled: false, physics2dData: {} };
    expect(guessLegacyPublicationProjectType(legacyScene([disabled]))).toBeNull();
  });

  it('leaves every scene that states a type, or a value the engine refuses, to the stated value', () => {
    for (const projectType of ['2d', '3d', '2D', 7]) {
      const scene = { ...legacyScene([sprite('player')]), metadata: { name: 'S', projectType } };
      expect(guessLegacyPublicationProjectType(scene)).toBeNull();
    }
  });

  it('reads an explicit null as no key, like the engine', () => {
    const scene = { ...legacyScene([sprite('player')]), metadata: { name: 'S', projectType: null } };
    expect(guessLegacyPublicationProjectType(scene)).toBe('2d');
  });

  it.each([null, 'scene', [], {}, { metadata: {} }, legacyScene([]), legacyScene([null]), legacyScene(['sprite'])])(
    'answers null for an empty or malformed scene: %j',
    (value) => {
      expect(guessLegacyPublicationProjectType(value)).toBeNull();
    },
  );

  // A hole in the entity list must not be skipped (an `.every` would skip it
  // and fail OPEN). The hole is the input under test.
  it('treats a hole in the entity list as unknown, not as agreement', () => {
    const entities: unknown[] = [sprite('a')];
    entities[2] = sprite('c');
    expect(guessLegacyPublicationProjectType(legacyScene(entities))).toBeNull();
  });
});

describe('sceneHasThreeDOnlyContent (the backfill contradiction check, #10368)', () => {
  it('is true for a 3D-only entity type or field anywhere in the list, whatever the key says', () => {
    expect(sceneHasThreeDOnlyContent(legacyScene([sprite('a'), { entityId: 'l', entityType: 'terrain' }]))).toBe(true);
    expect(sceneHasThreeDOnlyContent(legacyScene([{ ...sprite('a'), assetRef: { assetId: 'x' } }]))).toBe(true);
    const stated = { ...legacyScene([{ entityId: 'm', entityType: 'gltf_model' }]), metadata: { projectType: '2d' } };
    expect(sceneHasThreeDOnlyContent(stated)).toBe(true);
  });

  it('is false for 2D content, plain meshes, lights and malformed scenes', () => {
    expect(sceneHasThreeDOnlyContent(legacyScene([sprite('a'), physics2dCube('b'), meshCube, light]))).toBe(false);
    for (const value of [null, 'scene', {}, legacyScene([]), legacyScene([null])]) {
      expect(sceneHasThreeDOnlyContent(value)).toBe(false);
    }
  });

  // The hole is the input under test: it is not an entity, so it must neither
  // throw nor end the walk before the entity after it.
  it('sees a 3D-only entity that sits after a hole', () => {
    const entities: unknown[] = [sprite('a')];
    entities[2] = { entityId: 't', entityType: 'terrain' };
    expect(sceneHasThreeDOnlyContent(legacyScene(entities))).toBe(true);
  });
});

/**
 * The tables restate engine names, so pin each against the engine source: a
 * renamed field or entity type would otherwise leave the rule silently
 * matching nothing (lessons-learned #18).
 */
describe('the classifier tables name real engine vocabulary', () => {
  const snapshot = readFileSync(resolve(ENGINE, 'history.rs'), 'utf8');
  const start = snapshot.indexOf('pub struct EntitySnapshot {');
  const body = snapshot.slice(start, snapshot.indexOf('\n}\n', start));
  const camel = (snake: string) => snake.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
  const fields = new Set([...body.matchAll(/^\s*pub ([a-z0-9_]+):/gm)].map((m) => camel(m[1])));

  const entityTypesSource = readFileSync(resolve(ENGINE, 'pending/mod.rs'), 'utf8');
  const entityTypes = new Set(
    [...entityTypesSource.matchAll(/^\s*"([a-z_]+)" => Some\(EntityType::/gm)].map((m) => m[1]),
  );

  it('parsed both sources (non-vacuous)', () => {
    expect(start).toBeGreaterThan(-1);
    expect(fields.size).toBeGreaterThan(20);
    expect(fields.has('entityType')).toBe(true);
    expect(entityTypes.size).toBeGreaterThan(10);
    expect(entityTypes.has('sprite')).toBe(true);
  });

  it.each([...TWO_D_FIELDS, ...THREE_D_ONLY_FIELDS, 'physics2dEnabled'])('%s is an EntitySnapshot field', (field) => {
    expect(fields.has(field)).toBe(true);
  });

  it.each([...THREE_D_ONLY_ENTITY_TYPES, ...NEUTRAL_ENTITY_TYPES, 'sprite'])('%s is an EntityType spelling', (name) => {
    expect(entityTypes.has(name)).toBe(true);
  });
});
