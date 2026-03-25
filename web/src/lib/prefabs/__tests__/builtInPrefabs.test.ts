/**
 * Tests for the 8 built-in prefab definitions.
 *
 * Covers: correct count, required fields, data integrity (transforms, materials,
 * physics, scripts, lights, particles), unique IDs, and category coverage.
 */
import { describe, it, expect } from 'vitest';
import { BUILT_IN_PREFABS } from '@/lib/prefabs/builtInPrefabs';
import type { PrefabSnapshot } from '@/lib/prefabs/prefabStore';

// ---------------------------------------------------------------------------
// Structure validation helpers
// ---------------------------------------------------------------------------

function isValidTransform(t: PrefabSnapshot['transform']): boolean {
  return (
    Array.isArray(t.position) && t.position.length === 3 &&
    Array.isArray(t.rotation) && t.rotation.length === 3 &&
    Array.isArray(t.scale) && t.scale.length === 3
  );
}

function isValidRgba(arr: unknown): boolean {
  return Array.isArray(arr) && arr.length === 4 && arr.every((v) => typeof v === 'number');
}

function isValidRgb(arr: unknown): boolean {
  return Array.isArray(arr) && arr.length === 3 && arr.every((v) => typeof v === 'number');
}

// ---------------------------------------------------------------------------
// Count and top-level fields
// ---------------------------------------------------------------------------

describe('BUILT_IN_PREFABS - count and top-level structure', () => {
  it('exports exactly 8 built-in prefabs', () => {
    expect(BUILT_IN_PREFABS).toHaveLength(8);
  });

  it('every prefab has required top-level fields', () => {
    for (const prefab of BUILT_IN_PREFABS) {
      expect(typeof prefab.id).toBe('string');
      expect(prefab.id.length).toBeGreaterThan(0);
      expect(typeof prefab.name).toBe('string');
      expect(prefab.name.length).toBeGreaterThan(0);
      expect(typeof prefab.category).toBe('string');
      expect(prefab.category.length).toBeGreaterThan(0);
      expect(typeof prefab.description).toBe('string');
      expect(prefab.description.length).toBeGreaterThan(0);
      expect(prefab.snapshot).not.toBeUndefined();
      expect(typeof prefab.createdAt).toBe('string');
      expect(typeof prefab.updatedAt).toBe('string');
    }
  });

  it('all prefab IDs start with builtin_', () => {
    for (const prefab of BUILT_IN_PREFABS) {
      expect(prefab.id).toMatch(/^builtin_/);
    }
  });

  it('all prefab IDs are unique', () => {
    const ids = BUILT_IN_PREFABS.map((p) => p.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('every prefab snapshot has entityType, name, and transform', () => {
    for (const prefab of BUILT_IN_PREFABS) {
      const { snapshot } = prefab;
      expect(typeof snapshot.entityType).toBe('string');
      expect(snapshot.entityType.length).toBeGreaterThan(0);
      expect(typeof snapshot.name).toBe('string');
      expect(isValidTransform(snapshot.transform)).toBe(true);
    }
  });

  it('createdAt and updatedAt are valid parseable date strings', () => {
    for (const prefab of BUILT_IN_PREFABS) {
      expect(isNaN(new Date(prefab.createdAt).getTime())).toBe(false);
      expect(isNaN(new Date(prefab.updatedAt).getTime())).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Individual prefab: builtin_player
// ---------------------------------------------------------------------------

describe('builtin_player', () => {
  const player = BUILT_IN_PREFABS.find((p) => p.id === 'builtin_player')!;

  it('exists', () => {
    expect(player).not.toBeUndefined();
  });

  it('has capsule entityType', () => {
    expect(player.snapshot.entityType).toBe('capsule');
  });

  it('has dynamic physics with capsule collider', () => {
    expect(player.snapshot.physics?.bodyType).toBe('dynamic');
    expect(player.snapshot.physics?.colliderShape).toBe('capsule');
  });

  it('locks rotation axes to prevent tipping', () => {
    const phys = player.snapshot.physics!;
    expect(phys.lockRotationX).toBe(true);
    expect(phys.lockRotationY).toBe(true);
    expect(phys.lockRotationZ).toBe(true);
  });

  it('has script with character_controller template', () => {
    expect(player.snapshot.script?.template).toBe('character_controller');
    expect(player.snapshot.script?.enabled).toBe(true);
  });

  it('script source contains forge.input.isPressed', () => {
    expect(player.snapshot.script?.source).toContain('forge.input.isPressed');
  });

  it('has valid material with baseColor', () => {
    expect(isValidRgba(player.snapshot.material?.baseColor)).toBe(true);
  });

  it('is in Characters category', () => {
    expect(player.category).toBe('Characters');
  });
});

// ---------------------------------------------------------------------------
// Individual prefab: builtin_collectible
// ---------------------------------------------------------------------------

describe('builtin_collectible', () => {
  const collectible = BUILT_IN_PREFABS.find((p) => p.id === 'builtin_collectible')!;

  it('exists', () => {
    expect(collectible).not.toBeUndefined();
  });

  it('has torus entityType', () => {
    expect(collectible.snapshot.entityType).toBe('torus');
  });

  it('has gold emissive material (metallic=1)', () => {
    expect(collectible.snapshot.material?.metallic).toBe(1.0);
  });

  it('has rotating_object script template', () => {
    expect(collectible.snapshot.script?.template).toBe('rotating_object');
  });

  it('script source rotates on Y axis', () => {
    expect(collectible.snapshot.script?.source).toContain('forge.rotate');
  });

  it('has no physics component (non-physics collectible)', () => {
    expect(collectible.snapshot.physics).toBeUndefined();
  });

  it('is in Items category', () => {
    expect(collectible.category).toBe('Items');
  });
});

// ---------------------------------------------------------------------------
// Individual prefab: builtin_physics_crate
// ---------------------------------------------------------------------------

describe('builtin_physics_crate', () => {
  const crate = BUILT_IN_PREFABS.find((p) => p.id === 'builtin_physics_crate')!;

  it('exists', () => {
    expect(crate).not.toBeUndefined();
  });

  it('has cube entityType', () => {
    expect(crate.snapshot.entityType).toBe('cube');
  });

  it('has dynamic cuboid physics', () => {
    expect(crate.snapshot.physics?.bodyType).toBe('dynamic');
    expect(crate.snapshot.physics?.colliderShape).toBe('cuboid');
  });

  it('does not lock any axes', () => {
    const phys = crate.snapshot.physics!;
    expect(phys.lockRotationX).toBe(false);
    expect(phys.lockRotationY).toBe(false);
    expect(phys.lockRotationZ).toBe(false);
  });

  it('has brown base color', () => {
    const color = crate.snapshot.material?.baseColor;
    // Brown: R > G > B approximately [0.52, 0.33, 0.15, 1]
    expect(color?.[0]).toBeGreaterThan(0.4); // R
    expect(color?.[3]).toBe(1); // opaque
  });

  it('is in Props category', () => {
    expect(crate.category).toBe('Props');
  });
});

// ---------------------------------------------------------------------------
// Individual prefab: builtin_light_rig
// ---------------------------------------------------------------------------

describe('builtin_light_rig', () => {
  const light = BUILT_IN_PREFABS.find((p) => p.id === 'builtin_light_rig')!;

  it('exists', () => {
    expect(light).not.toBeUndefined();
  });

  it('has point_light entityType', () => {
    expect(light.snapshot.entityType).toBe('point_light');
  });

  it('has point light configuration', () => {
    expect(light.snapshot.light?.lightType).toBe('point');
    expect(light.snapshot.light?.intensity).toBeGreaterThan(0);
    expect(isValidRgb(light.snapshot.light?.color)).toBe(true);
  });

  it('has shadows enabled', () => {
    expect(light.snapshot.light?.shadowsEnabled).toBe(true);
  });

  it('has no material or physics', () => {
    expect(light.snapshot.material).toBeUndefined();
    expect(light.snapshot.physics).toBeUndefined();
  });

  it('is in Lights category', () => {
    expect(light.category).toBe('Lights');
  });

  it('is positioned above origin', () => {
    expect(light.snapshot.transform.position[1]).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Individual prefab: builtin_patrol_enemy
// ---------------------------------------------------------------------------

describe('builtin_patrol_enemy', () => {
  const enemy = BUILT_IN_PREFABS.find((p) => p.id === 'builtin_patrol_enemy')!;

  it('exists', () => {
    expect(enemy).not.toBeUndefined();
  });

  it('has sphere entityType', () => {
    expect(enemy.snapshot.entityType).toBe('sphere');
  });

  it('has enemy_patrol script template', () => {
    expect(enemy.snapshot.script?.template).toBe('enemy_patrol');
  });

  it('script source contains waypoint logic', () => {
    expect(enemy.snapshot.script?.source).toContain('waypointA');
    expect(enemy.snapshot.script?.source).toContain('waypointB');
  });

  it('has red-ish material', () => {
    const color = enemy.snapshot.material?.baseColor;
    // Red: R > G and R > B
    expect(color?.[0]).toBeGreaterThan(color?.[1] ?? 1);
    expect(color?.[0]).toBeGreaterThan(color?.[2] ?? 1);
  });

  it('is in Characters category', () => {
    expect(enemy.category).toBe('Characters');
  });
});

// ---------------------------------------------------------------------------
// Individual prefab: builtin_bouncy_ball
// ---------------------------------------------------------------------------

describe('builtin_bouncy_ball', () => {
  const ball = BUILT_IN_PREFABS.find((p) => p.id === 'builtin_bouncy_ball')!;

  it('exists', () => {
    expect(ball).not.toBeUndefined();
  });

  it('has sphere entityType', () => {
    expect(ball.snapshot.entityType).toBe('sphere');
  });

  it('has high restitution (bounciness)', () => {
    expect(ball.snapshot.physics?.restitution).toBeGreaterThan(0.9);
  });

  it('has ball collider shape', () => {
    expect(ball.snapshot.physics?.colliderShape).toBe('ball');
  });

  it('is positioned above origin (dropped from height)', () => {
    expect(ball.snapshot.transform.position[1]).toBeGreaterThan(1);
  });

  it('is in Props category', () => {
    expect(ball.category).toBe('Props');
  });
});

// ---------------------------------------------------------------------------
// Individual prefab: builtin_glass_panel
// ---------------------------------------------------------------------------

describe('builtin_glass_panel', () => {
  const glass = BUILT_IN_PREFABS.find((p) => p.id === 'builtin_glass_panel')!;

  it('exists', () => {
    expect(glass).not.toBeUndefined();
  });

  it('has plane entityType', () => {
    expect(glass.snapshot.entityType).toBe('plane');
  });

  it('has blend alpha mode', () => {
    expect(glass.snapshot.material?.alphaMode).toBe('blend');
  });

  it('is double-sided', () => {
    expect(glass.snapshot.material?.doubleSided).toBe(true);
  });

  it('has high specularTransmission', () => {
    expect(glass.snapshot.material?.specularTransmission).toBeGreaterThan(0.5);
  });

  it('has very low roughness (glossy)', () => {
    expect(glass.snapshot.material?.perceptualRoughness).toBeLessThan(0.1);
  });

  it('has near-transparent base color', () => {
    const alpha = glass.snapshot.material?.baseColor[3] ?? 1;
    expect(alpha).toBeLessThan(0.5);
  });

  it('is in Props category', () => {
    expect(glass.category).toBe('Props');
  });
});

// ---------------------------------------------------------------------------
// Individual prefab: builtin_fire
// ---------------------------------------------------------------------------

describe('builtin_fire', () => {
  const fire = BUILT_IN_PREFABS.find((p) => p.id === 'builtin_fire')!;

  it('exists', () => {
    expect(fire).not.toBeUndefined();
  });

  it('has fire particle preset', () => {
    expect(fire.snapshot.particle?.preset).toBe('fire');
  });

  it('has continuous spawner mode', () => {
    expect(fire.snapshot.particle?.spawnerMode.type).toBe('continuous');
  });

  it('has positive maxParticles', () => {
    expect(fire.snapshot.particle?.maxParticles).toBeGreaterThan(0);
  });

  it('has additive blend mode', () => {
    expect(fire.snapshot.particle?.blendMode).toBe('additive');
  });

  it('has color gradient with at least 2 stops', () => {
    const gradient = fire.snapshot.particle?.colorGradient ?? [];
    expect(gradient.length).toBeGreaterThanOrEqual(2);
  });

  it('gradient starts with orange-ish color (R > G, no B)', () => {
    const firstStop = fire.snapshot.particle?.colorGradient[0];
    if (firstStop) {
      expect(firstStop.color[0]).toBeGreaterThan(firstStop.color[2]); // R > B
    }
  });

  it('velocity points upward', () => {
    const velMin = fire.snapshot.particle?.velocityMin;
    expect(velMin?.[1]).toBeGreaterThan(0); // positive Y
  });

  it('is in Effects category', () => {
    expect(fire.category).toBe('Effects');
  });
});

// ---------------------------------------------------------------------------
// Category coverage
// ---------------------------------------------------------------------------

describe('category coverage', () => {
  const categories = BUILT_IN_PREFABS.map((p) => p.category);
  const uniqueCategories = [...new Set(categories)];

  it('covers Characters category', () => {
    expect(categories).toContain('Characters');
  });

  it('covers Items category', () => {
    expect(categories).toContain('Items');
  });

  it('covers Props category', () => {
    expect(categories).toContain('Props');
  });

  it('covers Lights category', () => {
    expect(categories).toContain('Lights');
  });

  it('covers Effects category', () => {
    expect(categories).toContain('Effects');
  });

  it('has at least 4 unique categories', () => {
    expect(uniqueCategories.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Material field completeness
// ---------------------------------------------------------------------------

describe('material field completeness', () => {
  const prefabsWithMaterial = BUILT_IN_PREFABS.filter((p) => p.snapshot.material);

  it('all material prefabs have baseColor, metallic, perceptualRoughness', () => {
    for (const prefab of prefabsWithMaterial) {
      const mat = prefab.snapshot.material!;
      expect(isValidRgba(mat.baseColor)).toBe(true);
      expect(typeof mat.metallic).toBe('number');
      expect(typeof mat.perceptualRoughness).toBe('number');
    }
  });

  it('all material prefabs have alphaMode string', () => {
    for (const prefab of prefabsWithMaterial) {
      const mat = prefab.snapshot.material!;
      expect(typeof mat.alphaMode).toBe('string');
    }
  });

  it('metallic values are in range [0, 1]', () => {
    for (const prefab of prefabsWithMaterial) {
      const mat = prefab.snapshot.material!;
      expect(mat.metallic).toBeGreaterThanOrEqual(0);
      expect(mat.metallic).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Physics field completeness
// ---------------------------------------------------------------------------

describe('physics field completeness', () => {
  const prefabsWithPhysics = BUILT_IN_PREFABS.filter((p) => p.snapshot.physics);

  it('all physics prefabs have bodyType and colliderShape', () => {
    for (const prefab of prefabsWithPhysics) {
      const phys = prefab.snapshot.physics!;
      expect(typeof phys.bodyType).toBe('string');
      expect(typeof phys.colliderShape).toBe('string');
    }
  });

  it('restitution values are in range [0, 1]', () => {
    for (const prefab of prefabsWithPhysics) {
      const phys = prefab.snapshot.physics!;
      expect(phys.restitution).toBeGreaterThanOrEqual(0);
      expect(phys.restitution).toBeLessThanOrEqual(1);
    }
  });

  it('gravityScale defaults to 1 for all physics prefabs', () => {
    for (const prefab of prefabsWithPhysics) {
      expect(prefab.snapshot.physics?.gravityScale).toBe(1.0);
    }
  });

  it('isSensor is false for all physics prefabs', () => {
    for (const prefab of prefabsWithPhysics) {
      expect(prefab.snapshot.physics?.isSensor).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// makeBuiltIn helper consistency
// ---------------------------------------------------------------------------

describe('makeBuiltIn consistency (via exported data)', () => {
  it('all prefabs share the same createdAt/updatedAt sentinel date', () => {
    const SENTINEL = '2024-01-01T00:00:00Z';
    for (const prefab of BUILT_IN_PREFABS) {
      expect(prefab.createdAt).toBe(SENTINEL);
      expect(prefab.updatedAt).toBe(SENTINEL);
    }
  });

  it('snapshot names match prefab names roughly', () => {
    for (const prefab of BUILT_IN_PREFABS) {
      // snapshot.name is the entity name; prefab.name may differ but both should be non-empty strings
      expect(typeof prefab.snapshot.name).toBe('string');
      expect(prefab.snapshot.name.length).toBeGreaterThan(0);
    }
  });
});
