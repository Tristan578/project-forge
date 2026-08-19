/**
 * Tests for the `feedback` system definition.
 *
 * `feedback` is the GDD category that carries health/damage, so it is the only
 * place a generated game gets hit points. Registering the category also REMOVES
 * planBuilder's `custom_script_generate` fall-through for it, so a feedback
 * system this definition cannot translate must warn rather than silently
 * produce nothing (PF-1199).
 *
 * Health property bags are asserted in FULL with `toEqual`: the engine merges a
 * partial bag onto `HealthData::default()`, so a missing key is not a type
 * error and not a runtime error — it is a silently different game.
 */

import { describe, it, expect, vi } from 'vitest';
import { SYSTEM_REGISTRY } from '../index';
import type { SystemStepContext, SystemStepInput, PlannedEntity } from '../index';
import { EXECUTOR_REGISTRY } from '../../executors';
import type { GameSystem, OrchestratorGDD, EntityBlueprint } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function planned(entityId: string, name: string, role: EntityBlueprint['role']): PlannedEntity {
  return {
    entityId,
    scene: 'Level1',
    entity: { name, role, systems: [], appearance: 'primitive:cube' },
  };
}

function makeCtx(
  entities: PlannedEntity[],
  warn = vi.fn(),
): SystemStepContext & { warn: ReturnType<typeof vi.fn> } {
  return { entities, warn };
}

function makeSystem(type: string, config: Record<string, unknown> = {}): GameSystem {
  return { category: 'feedback', type, config, priority: 'core', dependsOn: [] };
}

function makeGdd(): OrchestratorGDD {
  return {
    id: 'gdd-1',
    title: 'Test Game',
    description: 'A test game',
    systems: [],
    scenes: [],
    assetManifest: [],
    estimatedScope: 'small',
    styleDirective: 'minimal',
    feelDirective: {
      mood: 'tense',
      pacing: 'fast',
      weight: 'heavy',
      referenceGames: [],
      oneLiner: 'test',
    },
    constraints: [],
    projectType: '3d',
  };
}

function run(system: GameSystem, ctx: SystemStepContext): SystemStepInput[] {
  const def = SYSTEM_REGISTRY.get('feedback');
  if (!def) throw new Error('feedback system is not registered');
  return def.setupSteps(system, makeGdd(), ctx);
}

function healthOf(steps: SystemStepInput[], entityId: string): Record<string, unknown> | undefined {
  const step = steps.find(s => s.input.entityId === entityId && s.input.type === 'health');
  return step?.input;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('feedback system', () => {
  it('is registered', () => {
    expect(SYSTEM_REGISTRY.has('feedback')).toBe(true);
  });

  it('only ever names executors that exist', () => {
    const ctx = makeCtx([planned('id-hero', 'Hero', 'player')]);
    const steps = run(makeSystem('health', {}), ctx);
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(EXECUTOR_REGISTRY.has(step.executor)).toBe(true);
    }
  });

  it('gives the player a COMPLETE health bag', () => {
    const ctx = makeCtx([planned('id-hero', 'Hero', 'player')]);
    const steps = run(makeSystem('health', {}), ctx);

    expect(steps).toHaveLength(1);
    expect(steps[0].executor).toBe('game_component');
    expect(steps[0].input).toEqual({
      entityId: 'id-hero',
      type: 'health',
      maxHp: 100,
      currentHp: 100,
      invincibilitySecs: 0.5,
      respawnOnDeath: true,
      respawnPoint: [0, 1, 0],
      despawnOnDeath: false,
    });
  });

  it('reads the configured max health and starts the player at full', () => {
    const ctx = makeCtx([planned('id-hero', 'Hero', 'player')]);
    const steps = run(makeSystem('health', { maxHealth: 250 }), ctx);

    const health = healthOf(steps, 'id-hero');
    expect(health?.maxHp).toBe(250);
    expect(health?.currentHp).toBe(250);
  });

  it.each([
    ['maxHealth', 'maxHealth'],
    ['maxHp', 'maxHp'],
    ['health', 'health'],
    ['hp', 'hp'],
  ])('accepts the %s config spelling', (_label, key) => {
    const ctx = makeCtx([planned('id-hero', 'Hero', 'player')]);
    const steps = run(makeSystem('health', { [key]: 40 }), ctx);
    expect(healthOf(steps, 'id-hero')?.maxHp).toBe(40);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Infinity],
    ['zero', 0],
    ['negative', -10],
    ['a string', '250'],
    ['null', null],
  ])('ignores a max health that is %s and keeps a playable default', (_label, maxHealth) => {
    const ctx = makeCtx([planned('id-hero', 'Hero', 'player')]);
    const steps = run(makeSystem('health', { maxHealth }), ctx);

    const health = healthOf(steps, 'id-hero');
    expect(Number.isFinite(health?.maxHp)).toBe(true);
    expect(health?.maxHp as number).toBeGreaterThan(0);
    expect(health?.currentHp).toBe(health?.maxHp);
  });

  it('gives enemies health too, and does not respawn them', () => {
    const entities = [
      planned('id-hero', 'Hero', 'player'),
      planned('id-grunt', 'Grunt', 'enemy'),
    ];
    const ctx = makeCtx(entities);
    const steps = run(makeSystem('health', { maxHealth: 60 }), ctx);

    expect(steps.map(s => s.input.entityId).sort()).toEqual(['id-grunt', 'id-hero']);
    expect(healthOf(steps, 'id-grunt')).toEqual({
      entityId: 'id-grunt',
      type: 'health',
      maxHp: 60,
      currentHp: 60,
      invincibilitySecs: 0,
      respawnOnDeath: false,
      respawnPoint: [0, 1, 0],
      despawnOnDeath: true,
    });
  });

  it('leaves scenery alone', () => {
    const entities = [
      planned('id-hero', 'Hero', 'player'),
      planned('id-tree', 'Tree', 'decoration'),
      planned('id-coin', 'Coin', 'interactable'),
    ];
    const ctx = makeCtx(entities);
    const steps = run(makeSystem('health', {}), ctx);

    expect(steps.map(s => s.input.entityId)).toEqual(['id-hero']);
  });

  it.each([
    ['damage', 'damage'],
    ['health-and-damage', 'health-and-damage'],
    ['combat damage', 'combat_damage'],
  ])('treats %s as a health system', (_label, type) => {
    const ctx = makeCtx([planned('id-hero', 'Hero', 'player')]);
    const steps = run(makeSystem(type, {}), ctx);
    expect(healthOf(steps, 'id-hero')).toBeDefined();
  });

  it('treats a system whose CONFIG is health-shaped as a health system', () => {
    const ctx = makeCtx([planned('id-hero', 'Hero', 'player')]);
    const steps = run(makeSystem('hud', { maxHealth: 3 }), ctx);
    expect(healthOf(steps, 'id-hero')?.maxHp).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Drop-and-warn
  // -------------------------------------------------------------------------

  it('DROPS and warns when a health system has nothing to be damaged', () => {
    const warn = vi.fn();
    const ctx = makeCtx([planned('id-tree', 'Tree', 'decoration')], warn);
    const steps = run(makeSystem('health', {}), ctx);

    expect(steps).toEqual([]);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/health/i);
  });

  it('DROPS and warns for a feedback system that is not about health', () => {
    const warn = vi.fn();
    const ctx = makeCtx([planned('id-hero', 'Hero', 'player')], warn);
    const steps = run(makeSystem('screen-shake', { intensity: 0.4 }), ctx);

    expect(steps).toEqual([]);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/screen-shake/);
  });

  it('DROPS and warns when the design planned no entities at all', () => {
    const warn = vi.fn();
    const ctx = makeCtx([], warn);
    const steps = run(makeSystem('health', {}), ctx);

    expect(steps).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('never carries a key the game component executor does not accept', () => {
    const ctx = makeCtx([planned('id-hero', 'Hero', 'player')]);
    const steps = run(makeSystem('health', { maxHealth: 5, regeneration: true, unknownKnob: 9 }), ctx);

    expect(Object.keys(steps[0].input).sort()).toEqual([
      'currentHp',
      'despawnOnDeath',
      'entityId',
      'invincibilitySecs',
      'maxHp',
      'respawnOnDeath',
      'respawnPoint',
      'type',
    ]);
  });
});
