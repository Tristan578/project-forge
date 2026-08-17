import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  buildCompoundResult,
  buildMaterialFromPartial,
  buildLightFromPartial,
  buildPhysicsFromPartial,
  buildGameComponentFromInput,
  inferEntityType,
  identifyRole,
  mulberry32,
  wallFromStartEnd,
} from '../helpers';
import { ownEntry } from '../types';

describe('ownEntry', () => {
  it('returns an own value', () => {
    expect(ownEntry({ a: 1 }, 'a')).toBe(1);
  });

  it('returns undefined for an absent key', () => {
    expect(ownEntry({ a: 1 }, 'b')).toBeUndefined();
  });

  it.each(['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty'])(
    'returns undefined for the inherited key %s',
    (key) => {
      const record: Record<string, { bodyType: string }> = {};
      // A bare `record[key]` here resolves to `Object.prototype` or a function.
      // Both are TRUTHY, so `?? defaults()` never falls back and
      // `if (!data) return error` never reports the entity missing (PF-1167).
      expect(record[key]).toBeTruthy();
      expect(ownEntry(record, key)).toBeUndefined();
    },
  );

  it('returns an own key that happens to be named __proto__', () => {
    // `{ __proto__: v }` sets the prototype rather than an own key, so this is
    // the only way such a record arises — and it does arise, from any parsed
    // JSON (an imported scene, an LLM tool argument).
    const record = JSON.parse('{"__proto__": {"bodyType": "static"}}') as Record<
      string,
      { bodyType: string }
    >;
    expect(ownEntry(record, '__proto__')).toEqual({ bodyType: 'static' });
  });

  it.each([
    ['zero', 0],
    ['empty string', ''],
    ['false', false],
    ['null', null],
  ])('distinguishes a present-but-falsy value (%s) from an absent one', (_label, value) => {
    // A truthiness check on the result would collapse these into "missing".
    expect(ownEntry({ a: value } as Record<string, unknown>, 'a')).toBe(value);
  });

  it('reads from a null-prototype record', () => {
    const record = Object.create(null) as Record<string, number>;
    record.a = 1;
    expect(ownEntry(record, 'a')).toBe(1);
    expect(ownEntry(record, '__proto__')).toBeUndefined();
  });
});

describe('buildCompoundResult', () => {
  it('should report full success', () => {
    const ops = [
      { action: 'spawn', success: true, entityId: 'a' },
      { action: 'spawn', success: true, entityId: 'b' },
    ];
    const result = buildCompoundResult(ops, { Cube: 'a', Sphere: 'b' });

    expect(result.success).toBe(true);
    expect(result.partialSuccess).toBe(false);
    expect(result.entityIds).toEqual({ Cube: 'a', Sphere: 'b' });
    expect(result.summary).toContain('Created 2 entities');
  });

  it('should report partial success', () => {
    const ops = [
      { action: 'spawn', success: true, entityId: 'a' },
      { action: 'spawn', success: false, error: 'failed' },
    ];
    const result = buildCompoundResult(ops, { Cube: 'a' });

    expect(result.success).toBe(false);
    expect(result.partialSuccess).toBe(true);
    expect(result.summary).toContain('Partial success');
  });

  it('should report total failure', () => {
    const ops = [
      { action: 'spawn', success: false, error: 'e1' },
      { action: 'spawn', success: false, error: 'e2' },
    ];
    const result = buildCompoundResult(ops, {});

    expect(result.success).toBe(false);
    expect(result.partialSuccess).toBe(false);
    expect(result.summary).toContain('Failed');
    expect(result.summary).toContain('2 errors');
  });
});

describe('buildMaterialFromPartial', () => {
  it('should use all defaults for empty input', () => {
    const mat = buildMaterialFromPartial({});

    expect(mat.baseColor).toEqual([1, 1, 1, 1]);
    expect(mat.metallic).toBe(0);
    expect(mat.perceptualRoughness).toBe(0.5);
    expect(mat.alphaMode).toBe('opaque');
    expect(mat.doubleSided).toBe(false);
    expect(mat.unlit).toBe(false);
  });

  it('should override specified fields', () => {
    const mat = buildMaterialFromPartial({
      baseColor: [1, 0, 0, 1],
      metallic: 0.8,
      alphaMode: 'blend',
    });

    expect(mat.baseColor).toEqual([1, 0, 0, 1]);
    expect(mat.metallic).toBe(0.8);
    expect(mat.alphaMode).toBe('blend');
    expect(mat.perceptualRoughness).toBe(0.5); // still default
  });
});

describe('buildLightFromPartial', () => {
  it('should use all defaults for empty input', () => {
    const light = buildLightFromPartial({});

    expect(light.lightType).toBe('point');
    expect(light.color).toEqual([1, 1, 1]);
    expect(light.intensity).toBe(800);
    expect(light.shadowsEnabled).toBe(false);
    expect(light.range).toBe(20);
  });

  it('should override specified fields', () => {
    const light = buildLightFromPartial({
      lightType: 'spot',
      intensity: 2000,
      shadowsEnabled: true,
    });

    expect(light.lightType).toBe('spot');
    expect(light.intensity).toBe(2000);
    expect(light.shadowsEnabled).toBe(true);
  });
});

describe('buildPhysicsFromPartial', () => {
  it('should use all defaults for empty input', () => {
    const phys = buildPhysicsFromPartial({});

    expect(phys.bodyType).toBe('dynamic');
    expect(phys.colliderShape).toBe('auto');
    expect(phys.restitution).toBe(0.3);
    expect(phys.friction).toBe(0.5);
    expect(phys.density).toBe(1.0);
    expect(phys.gravityScale).toBe(1.0);
    expect(phys.isSensor).toBe(false);
  });

  it('should override specified fields', () => {
    const phys = buildPhysicsFromPartial({
      bodyType: 'fixed',
      restitution: 0.9,
      isSensor: true,
    });

    expect(phys.bodyType).toBe('fixed');
    expect(phys.restitution).toBe(0.9);
    expect(phys.isSensor).toBe(true);
  });
});

describe('buildGameComponentFromInput', () => {
  it('should build character_controller with defaults', () => {
    const comp = buildGameComponentFromInput('character_controller', {}) as Record<string, unknown>;
    expect(comp).not.toBeNull();
    expect(comp.type).toBe('characterController');
    const cc = comp.characterController as Record<string, unknown>;
    expect(cc.speed).toBe(5);
    expect(cc.jumpHeight).toBe(8);
  });

  it('should build health with overrides', () => {
    const comp = buildGameComponentFromInput('health', { maxHp: 200, respawnOnDeath: false }) as Record<string, unknown>;
    expect(comp.type).toBe('health');
    const h = comp.health as Record<string, unknown>;
    expect(h.maxHp).toBe(200);
    expect(h.currentHp).toBe(200);
    expect(h.respawnOnDeath).toBe(false);
    // Matches the engine's `default_true` — omitting the knob must not change
    // what an entity does at zero health.
    expect(h.despawnOnDeath).toBe(true);
  });

  it('should build health with despawnOnDeath disabled', () => {
    const comp = buildGameComponentFromInput('health', { despawnOnDeath: false }) as Record<string, unknown>;
    const h = comp.health as Record<string, unknown>;
    expect(h.despawnOnDeath).toBe(false);
  });

  it('should build collectible', () => {
    const comp = buildGameComponentFromInput('collectible', { value: 5 }) as Record<string, unknown>;
    expect(comp.type).toBe('collectible');
    expect((comp.collectible as Record<string, unknown>).value).toBe(5);
  });

  it('should build damage_zone', () => {
    const comp = buildGameComponentFromInput('damage_zone', { damagePerSecond: 50 }) as Record<string, unknown>;
    expect(comp.type).toBe('damageZone');
    expect((comp.damageZone as Record<string, unknown>).damagePerSecond).toBe(50);
  });

  it('should build moving_platform with defaults', () => {
    const comp = buildGameComponentFromInput('moving_platform', {}) as Record<string, unknown>;
    expect(comp.type).toBe('movingPlatform');
    const mp = comp.movingPlatform as Record<string, unknown>;
    expect(mp.speed).toBe(2);
    expect(mp.loopMode).toBe('pingPong');
  });

  it('should build spawner', () => {
    const comp = buildGameComponentFromInput('spawner', { entityType: 'sphere', maxCount: 10 }) as Record<string, unknown>;
    expect(comp.type).toBe('spawner');
    const s = comp.spawner as Record<string, unknown>;
    expect(s.entityType).toBe('sphere');
    expect(s.maxCount).toBe(10);
  });

  it('should build win_condition', () => {
    // `collectAll` is the one spelling the engine's match arm recognises; this
    // asserted `collect_all` survived, which pinned the passthrough that turned
    // a collect-all game into a score game (see the win-condition test below).
    const comp = buildGameComponentFromInput('win_condition', { conditionType: 'collectAll' }) as Record<string, unknown>;
    expect(comp.type).toBe('winCondition');
    expect((comp.winCondition as Record<string, unknown>).conditionType).toBe('collectAll');
  });

  it('should return null for unknown types', () => {
    expect(buildGameComponentFromInput('unknown_type', {})).toBeNull();
  });
});

describe('inferEntityType', () => {
  it('should detect point light', () => {
    expect(inferEntityType({ components: ['PointLight'] } as never)).toBe('point_light');
  });

  it('should detect directional light', () => {
    expect(inferEntityType({ components: ['DirectionalLight'] } as never)).toBe('directional_light');
  });

  it('should detect spot light', () => {
    expect(inferEntityType({ components: ['SpotLight'] } as never)).toBe('spot_light');
  });

  it('should detect mesh', () => {
    expect(inferEntityType({ components: ['Mesh3d', 'Transform'] } as never)).toBe('mesh');
  });

  it('should return unknown for empty components', () => {
    expect(inferEntityType({ components: [] } as never)).toBe('unknown');
  });

  it('should handle undefined components', () => {
    expect(inferEntityType({} as never)).toBe('unknown');
  });
});

describe('identifyRole', () => {
  const makeNode = (name: string, components: string[] = []) =>
    ({ name, components } as never);

  it('should identify player from characterController', () => {
    expect(identifyRole(makeNode('Hero'), [{ type: 'characterController' }] as never, false, false)).toBe('player');
  });

  it('should identify collectible', () => {
    expect(identifyRole(makeNode('Coin'), [{ type: 'collectible' }] as never, false, false)).toBe('collectible');
  });

  it('should identify goal from winCondition', () => {
    expect(identifyRole(makeNode('Goal'), [{ type: 'winCondition' }] as never, false, false)).toBe('goal');
  });

  it('should identify light from node components', () => {
    expect(identifyRole(makeNode('Sun', ['DirectionalLight']), [], false, false)).toBe('light');
  });

  it('should identify ground from name + physics', () => {
    expect(identifyRole(makeNode('Ground'), [], true, false)).toBe('ground');
  });

  it('should identify wall from name + physics', () => {
    expect(identifyRole(makeNode('Wall'), [], true, false)).toBe('obstacle');
  });

  it('should identify physics_object as fallback', () => {
    expect(identifyRole(makeNode('Box'), [], true, false)).toBe('physics_object');
  });

  it('should identify scripted entity', () => {
    expect(identifyRole(makeNode('NPC'), [], false, true)).toBe('scripted');
  });

  it('should default to decoration', () => {
    expect(identifyRole(makeNode('Tree'), [], false, false)).toBe('decoration');
  });
});

describe('mulberry32', () => {
  it('should produce deterministic sequence', () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(42);

    expect(rng1()).toBe(rng2());
    expect(rng1()).toBe(rng2());
    expect(rng1()).toBe(rng2());
  });

  it('should produce values in [0, 1)', () => {
    const rng = mulberry32(123);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('should produce different sequences for different seeds', () => {
    const rng1 = mulberry32(1);
    const rng2 = mulberry32(2);

    expect(rng1()).not.toBe(rng2());
  });
});

describe('wallFromStartEnd', () => {
  it('should calculate wall along Z axis', () => {
    const result = wallFromStartEnd([0, 0, 0], [0, 0, 10], 3, 0.5);

    expect(result.position).toEqual([0, 1.5, 5]); // midpoint, half height
    expect(result.scale).toEqual([0.5, 3, 10]);
    expect(result.rotation[1]).toBeCloseTo(0); // no rotation along Z
  });

  it('should calculate wall along X axis', () => {
    const result = wallFromStartEnd([0, 0, 0], [10, 0, 0], 4, 1);

    expect(result.position[0]).toBeCloseTo(5);
    expect(result.position[1]).toBeCloseTo(2);
    expect(result.position[2]).toBeCloseTo(0);
    expect(result.scale[2]).toBeCloseTo(10); // length
  });

  it('should handle diagonal walls', () => {
    const result = wallFromStartEnd([0, 0, 0], [3, 0, 4], 2, 0.3);

    expect(result.position).toEqual([1.5, 1, 2]); // midpoint
    const expectedLength = 5; // 3-4-5 triangle
    expect(result.scale[2]).toBeCloseTo(expectedLength);
  });
});

// ===========================================================================
// Bounds (PF-1160)
//
// The behaviour these builders are relied on for is that nothing they are
// handed can throw and nothing can leave with a value the engine cannot
// deserialize. Cases that need the whole handler to be meaningful live in
// compoundHandlers.test.ts instead.
// ===========================================================================

describe('bounds on model-supplied values', () => {
  it('never throws, whatever it is handed', () => {
    const junk: unknown[] = [null, undefined, 'text', 42, [], () => {}, { metallic: {} }];

    for (const input of junk) {
      expect(() => buildMaterialFromPartial(input as Record<string, unknown>)).not.toThrow();
      expect(() => buildLightFromPartial(input as Record<string, unknown>)).not.toThrow();
      expect(() => buildPhysicsFromPartial(input as Record<string, unknown>)).not.toThrow();
      expect(() => buildGameComponentFromInput('health', input as Record<string, unknown>)).not.toThrow();
    }
  });

  it('leaves a valid value exactly as supplied', () => {
    // The clamps must be invisible to any spec a model has business writing.
    const mat = buildMaterialFromPartial({ metallic: 0.35, perceptualRoughness: 0.9, ior: 1.45 });

    expect(mat.metallic).toBe(0.35);
    expect(mat.perceptualRoughness).toBe(0.9);
    expect(mat.ior).toBe(1.45);
  });

  it('drops an over-long identifier rather than truncating it', () => {
    // Half an entity id names the wrong entity; no id at all takes the default.
    const comp = buildGameComponentFromInput('follower', { targetEntityId: 'e'.repeat(300) });

    expect((comp as { follower: { targetEntityId: string | null } }).follower.targetEntityId).toBeNull();
  });

  it('rounds target_score, which the engine reads as Option<u32>', () => {
    const comp = buildGameComponentFromInput('win_condition', { conditionType: 'score', targetScore: 9.7 });

    expect((comp as { winCondition: { targetScore: number | null } }).winCondition.targetScore).toBe(10);
  });

  it('refuses a spawner interval of zero, which spawns every frame', () => {
    const comp = buildGameComponentFromInput('spawner', { intervalSecs: 0 });

    // The exact floor the engine clamps to, not merely "positive": a typo'd
    // 1e-30 is also positive, and would leave the store recording a value the
    // running spawner never holds.
    expect((comp as { spawner: { intervalSecs: number } }).spawner.intervalSecs).toBe(0.1);
  });

  it('caps an absurd spawner count at the engine\'s own ceiling', () => {
    const comp = buildGameComponentFromInput('spawner', { maxCount: 1e6 });

    expect((comp as { spawner: { maxCount: number } }).spawner.maxCount).toBe(1000);
  });

  it('drops an over-long name on a non-nullable field back to its own default', () => {
    // The nullable variant answers null; this one has no null to fall back to,
    // so it takes the builder's default instead of a truncated string.
    const comp = buildGameComponentFromInput('trigger_zone', { eventName: 'x'.repeat(300) });

    expect((comp as { triggerZone: { eventName: string } }).triggerZone.eventName).toBe('trigger');
  });

  it('still returns null for a component type it does not know', () => {
    expect(buildGameComponentFromInput('teleprompter', {})).toBeNull();
  });
});

describe('compoundHandlers does not shadow this module', () => {
  // PF-1160 was a private copy of every export below sitting in
  // compoundHandlers.ts and winning over the import, so the validated module
  // never ran. The four validating builders are protected by value assertions
  // elsewhere in the suite; the other five clamp nothing, so a re-added copy
  // of those would behave identically and no behavioural test could see it.
  // This one reads the source and can.
  const SHARED = [
    'buildCompoundResult',
    'buildMaterialFromPartial',
    'buildLightFromPartial',
    'buildPhysicsFromPartial',
    'buildGameComponentFromInput',
    'inferEntityType',
    'identifyRole',
    'mulberry32',
    'wallFromStartEnd',
  ] as const;

  const source = readFileSync(join(__dirname, '..', 'compoundHandlers.ts'), 'utf8');

  // The `\s*` before each keyword is load-bearing. A redeclaration does not
  // have to sit at the top level to win: a `function buildCompoundResult()`
  // inside a single handler body is a legal block-scoped shadow that raises no
  // duplicate-identifier error, and for the five non-clamping helpers no value
  // assertion anywhere would notice. Anchoring at column zero would see only
  // the shape PF-1160 happened to take.
  it.each(SHARED)('imports %s rather than declaring its own', (name) => {
    expect(source).not.toMatch(new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`, 'm'));
    expect(source).not.toMatch(new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${name}\\b`, 'm'));
  });

  // Naming the nine and finding *a* `from './helpers'` somewhere are two
  // different claims: the type-only `import type { GameplayAnalysis }` at the
  // top of the file already satisfies the second on its own. Bind them to the
  // same value-import block, so deleting that block fails here rather than
  // leaving the type import to answer for it.
  it('takes every one of them from a value import of ./helpers', () => {
    // `import\s+{` cannot match `import type {`, which is the point.
    const valueImports = [...source.matchAll(/import\s+{([^}]*)}\s*from\s*'\.\/helpers'/g)].map((m) => m[1]);
    expect(valueImports).toHaveLength(1);

    const imported = new Set(valueImports[0].split(',').map((s) => s.trim()).filter(Boolean));
    for (const name of SHARED) {
      expect(imported.has(name)).toBe(true);
    }
  });
});

describe('fields that are not numbers fall back rather than throwing', () => {
  // The numeric fields are covered above. These three are the other shapes
  // `zOpt`'s `.catch(undefined)` sits behind, and they are the branch whose
  // behaviour this change altered most: before it, `zPartialMaterial.parse`
  // THREW on a bad enum, and the throw would have been caught one level up and
  // reported as the whole step failing. Now it defaults silently, and that has
  // to be a written-down decision rather than an accident of composition.

  it('takes the default for an enum value the engine does not know', () => {
    expect(buildMaterialFromPartial({ alphaMode: 'glass' }).alphaMode).toBe('opaque');
  });

  it('takes the default for a boolean the model spelled as a word', () => {
    // The worst of the three: a wall the model meant to be immovable becomes a
    // dynamic body and falls out of the world. The default is still the right
    // answer — the alternative is dropping the entity's whole physics spec —
    // but it is the case most worth having on record.
    const physics = buildPhysicsFromPartial({ bodyType: 'squishy', isSensor: 'yes' });
    expect(physics.bodyType).toBe('dynamic');
    expect(physics.isSensor).toBe(false);
  });

  it('takes the default for a colour that is short a component', () => {
    // RGB against an RGBA tuple is an ordinary model slip, and the result is
    // silent: the material comes back white, not the red that was asked for.
    expect(buildMaterialFromPartial({ baseColor: [1, 0, 0] }).baseColor).toEqual([1, 1, 1, 1]);
  });
});

describe('the non-finite values zod rejects outright', () => {
  // F32_SAFE_MAX covers the finite-but-unusable band; this pins the claim in
  // its doc comment that zod already refuses what sits above it.
  it.each([Infinity, -Infinity, NaN])('falls back to the default for %p', (value) => {
    expect(buildMaterialFromPartial({ metallic: value }).metallic).toBe(0);
    expect(buildPhysicsFromPartial({ density: value }).density).toBe(1.0);
  });

  it('clamps a material field whose minimum is not zero', () => {
    // maxParallaxLayerCount is the one material field with a non-zero floor;
    // 0 layers is not "no parallax", it is a division the shader cannot do.
    expect(buildMaterialFromPartial({ maxParallaxLayerCount: 0 }).maxParallaxLayerCount).toBe(1);
    expect(buildMaterialFromPartial({ parallaxReliefMaxSteps: 120 }).parallaxReliefMaxSteps).toBe(64);
  });
});

describe('game-component bounds match the engine, field by field', () => {
  // The engine reads every one of these props through `prop_f32(props, key,
  // min, max)` / `prop_u32(props, key, max)`, which clamp on the Rust side. A
  // looser bound here is not permissive, it is a divergence: the store, the
  // inspector, undo history and scene export all record a value the running
  // entity never holds, and neither side reports anything.
  //
  // So the expected numbers are not written down here at all — they are read
  // out of the Rust, the way `gameCameraPayload.test.ts` reads its defaults.
  // A hand-mirrored table is exactly what this is guarding against.
  const RUST = join(__dirname, '..', '..', '..', '..', '..', '..', 'engine', 'src', 'core', 'game_components.rs');
  const source = readFileSync(RUST, 'utf8');

  const num = (literal: string): number =>
    literal === 'u32::MAX' ? 4_294_967_295 : Number(literal.replace(/_/g, ''));

  type Bound = { component: string; key: string; min: number; max: number };
  const bounds: Bound[] = [];
  let component: string | null = null;
  for (const line of source.split('\n')) {
    const arm = /^\s{8}"([a-z_]+)" => \{/.exec(line);
    if (arm) component = arm[1];
    if (!component) continue;
    const f32 = /prop_f32\(&props, "(\w+)", (-?[\d_]+\.\d+), (-?[\d_]+\.\d+)\)/.exec(line);
    if (f32) bounds.push({ component, key: f32[1], min: num(f32[2]), max: num(f32[3]) });
    const u32 = /prop_u32\(&props, "(\w+)", ([\d_]+|u32::MAX)\)/.exec(line);
    if (u32) bounds.push({ component, key: u32[1], min: 0, max: num(u32[2]) });
  }

  // Fail closed: an unreadable file, a renamed extractor or a reformatted call
  // site would otherwise leave this suite asserting nothing at all.
  it('found the engine call sites to compare against', () => {
    expect(bounds.length).toBeGreaterThanOrEqual(18);
    expect(bounds.every((b) => Number.isFinite(b.min) && Number.isFinite(b.max))).toBe(true);
  });

  // Components the engine knows and these builders do not (`interactable`)
  // answer null; they are a gap in PF-1142's other builder, not a drift here.
  const covered = bounds.filter((b) => buildGameComponentFromInput(b.component, {}) !== null);

  it('covers every component both sides know', () => {
    expect(new Set(covered.map((b) => b.component)).size).toBeGreaterThanOrEqual(10);
  });

  const read = (component: string, key: string, value: number): unknown => {
    const built = buildGameComponentFromInput(component, { [key]: value }) as
      | (Record<string, Record<string, unknown>> & { type: string })
      | null;
    return built === null ? null : built[built.type][key];
  };

  it.each(covered.map((b) => [`${b.component}.${b.key}`, b] as const))(
    '%s clamps to the engine range on both ends',
    (_label, b) => {
      expect(read(b.component, b.key, b.max + 1000)).toBe(b.max);
      expect(read(b.component, b.key, b.min - 1000)).toBe(b.min);
    },
  );
});

describe('fields the engine reads as something other than a number', () => {
  it('refuses a win condition the engine would silently turn into "score"', () => {
    // snake_case is the plausible model answer — every component type in the
    // same call is spelled that way — and the engine's match falls through to
    // Score, turning "collect all the coins" into "reach 10 points".
    const comp = buildGameComponentFromInput('win_condition', { conditionType: 'collect_all' });

    expect((comp as { winCondition: { conditionType: string } }).winCondition.conditionType).toBe('score');
    expect(
      (buildGameComponentFromInput('win_condition', { conditionType: 'collectAll' }) as
        { winCondition: { conditionType: string } }).winCondition.conditionType,
    ).toBe('collectAll');
  });

  it('drops a one-point waypoint list, which is a platform that never moves', () => {
    const comp = buildGameComponentFromInput('moving_platform', { waypoints: [[0, 0, 0]] });

    // The engine's mover early-returns below two points and reports nothing,
    // so the field falls back to the builder's own two-point default.
    const fallback = (buildGameComponentFromInput('moving_platform', {}) as
      { movingPlatform: { waypoints: number[][] } }).movingPlatform.waypoints;
    expect(fallback).toHaveLength(2);
    expect((comp as { movingPlatform: { waypoints: number[][] } }).movingPlatform.waypoints).toEqual(fallback);
  });

  it('keeps a vector component out of the f32 overflow band', () => {
    // 1e308 is finite, so `.finite()` alone passes it — and it is `inf` in f32.
    // The scalar fields were bounded from the start; the vectors were not.
    expect(buildMaterialFromPartial({ emissive: [1e308, 0, 0, 1] }).emissive).toEqual([1e30, 0, 0, 1]);
    expect(buildLightFromPartial({ color: [-1e308, 1, 1] }).color).toEqual([-1e30, 1, 1]);
  });
});
