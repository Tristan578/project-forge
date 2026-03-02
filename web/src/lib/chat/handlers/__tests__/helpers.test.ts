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
    const comp = buildGameComponentFromInput('win_condition', { conditionType: 'collect_all' }) as Record<string, unknown>;
    expect(comp.type).toBe('winCondition');
    expect((comp.winCondition as Record<string, unknown>).conditionType).toBe('collect_all');
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
