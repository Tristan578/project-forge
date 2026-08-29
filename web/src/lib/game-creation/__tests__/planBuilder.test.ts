/**
 * Tests for the Game Creation Orchestrator plan builder.
 *
 * Verifies that buildPlan() converts an OrchestratorGDD into a correctly
 * topologically-sorted OrchestratorPlan with tier caps, approval gates,
 * and accurate token estimates.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { OrchestratorGDD, GameSystem, AssetNeed } from '@/lib/game-creation/types';
import { buildPlan } from '@/lib/game-creation/planBuilder';
import { TIER_DISPLAY_NAMES } from '@/lib/billing/tierPlans';
import { TOKEN_COSTS } from '@/lib/tokens/pricing';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGdd(overrides: Partial<OrchestratorGDD> = {}): OrchestratorGDD {
  return {
    id: 'test-gdd-1',
    title: 'Test Game',
    description: 'A test game description',
    systems: [],
    scenes: [
      {
        name: 'Main',
        purpose: 'Main gameplay scene',
        systems: [],
        entities: [
          {
            name: 'Player',
            role: 'player',
            systems: [],
            appearance: 'capsule',
          },
        ],
        transitions: [],
      },
    ],
    assetManifest: [],
    estimatedScope: 'small',
    styleDirective: 'minimal',
    feelDirective: {
      mood: 'neutral',
      pacing: 'medium',
      weight: 'medium',
      referenceGames: [],
      oneLiner: 'a test game',
    },
    constraints: [],
    projectType: '3d',
    ...overrides,
  };
}

/** The entity_setup step for a named entity — where its engine id is minted. */
function findEntitySetup(plan: { steps: Array<{ executor: string; input: Record<string, unknown> }> }, name: string) {
  const step = plan.steps.find(
    s => s.executor === 'entity_setup' && (s.input.entity as { name: string }).name === name,
  );
  if (!step) throw new Error(`no entity_setup step for "${name}"`);
  return step;
}

function makeSystem(
  category: GameSystem['category'],
  type: string,
  priority: GameSystem['priority'] = 'core',
  dependsOn: GameSystem['dependsOn'] = [],
): GameSystem {
  return { category, type, config: {}, priority, dependsOn };
}

function makeAsset(
  description: string,
  priority: AssetNeed['priority'] = 'required',
  fallback = 'primitive:cube',
): AssetNeed {
  return {
    type: '3d-model',
    description,
    styleDirective: 'minimal',
    priority,
    fallback,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildPlan', () => {
  // 1. Basic GDD produces steps in correct order
  it('produces steps in correct phase order: scenes -> entities -> systems -> assets -> verify -> polish', () => {
    const gdd = makeGdd({
      systems: [makeSystem('movement', 'platformer')],
      assetManifest: [makeAsset('Player model')],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const executors = plan.steps.map(s => s.executor);

    // scene_create comes first
    const firstSceneIdx = executors.indexOf('scene_create');
    // entity_setup comes after scene_create
    const firstEntityIdx = executors.indexOf('entity_setup');
    // asset_generate comes after entity
    const firstAssetIdx = executors.indexOf('asset_generate');
    // verify_all_scenes comes before auto_polish
    const verifyIdx = executors.indexOf('verify_all_scenes');
    const polishIdx = executors.indexOf('auto_polish');

    expect(firstSceneIdx).toBeGreaterThanOrEqual(0);
    expect(firstEntityIdx).toBeGreaterThan(firstSceneIdx);
    expect(firstAssetIdx).toBeGreaterThan(firstEntityIdx);
    expect(verifyIdx).toBeGreaterThan(firstAssetIdx);
    expect(polishIdx).toBe(verifyIdx + 1);
  });

  // 2. dependsOn chains are correct
  it('entity steps depend on their scene step', () => {
    const gdd = makeGdd();
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    const sceneStep = plan.steps.find(s => s.executor === 'scene_create')!;
    const entityStep = plan.steps.find(s => s.executor === 'entity_setup')!;

    expect(sceneStep).toBeDefined();
    expect(entityStep).toBeDefined();
    expect(entityStep.dependsOn).toContain(sceneStep.id);
  });

  // 3. Tier cap limits asset steps (starter = 5)
  it('caps asset steps to tier limit for starter tier', () => {
    const assets = Array.from({ length: 10 }, (_, i) =>
      makeAsset(`Asset ${i}`, 'required'),
    );
    const gdd = makeGdd({ assetManifest: assets });

    const plan = buildPlan(gdd, 'proj-1', 'starter', 10000);
    const assetSteps = plan.steps.filter(s => s.executor === 'asset_generate');

    expect(assetSteps.length).toBeLessThanOrEqual(5);
    expect(assetSteps).toHaveLength(5);
  });

  // 4. Required assets prioritized over nice-to-have when capping
  it('prioritizes required assets over nice-to-have when applying tier cap', () => {
    const assets = [
      makeAsset('Nice asset 1', 'nice-to-have'),
      makeAsset('Nice asset 2', 'nice-to-have'),
      makeAsset('Required asset 1', 'required'),
      makeAsset('Required asset 2', 'required'),
      makeAsset('Required asset 3', 'required'),
      makeAsset('Required asset 4', 'required'),
      makeAsset('Required asset 5', 'required'),
    ];
    const gdd = makeGdd({ assetManifest: assets });

    // starter cap = 5, we have 5 required + 2 nice-to-have
    const plan = buildPlan(gdd, 'proj-1', 'starter', 10000);
    const assetSteps = plan.steps.filter(s => s.executor === 'asset_generate');

    // All 5 should be required assets
    expect(assetSteps).toHaveLength(5);
    // None should be optional (nice-to-have)
    const nonOptional = assetSteps.filter(s => !s.optional);
    expect(nonOptional).toHaveLength(5);
  });

  // 5. gate_plan created after first scene step
  it('creates gate_plan with afterStepId pointing to the first scene step (step_0)', () => {
    const gdd = makeGdd();
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    const gatePlan = plan.approvalGates.find(g => g.id === 'gate_plan');
    expect(gatePlan).toBeDefined();
    expect(gatePlan!.afterStepId).toBe('step_0');
    expect(plan.steps[0].id).toBe('step_0');
    // step_0 is now plan_present (no-op) so gate fires BEFORE scene creation
    expect(plan.steps[0].executor).toBe('plan_present');
    // First scene_create is step_1 and depends on plan_present
    expect(plan.steps[1].executor).toBe('scene_create');
    expect(plan.steps[1].dependsOn).toContain('step_0');
  });

  // 6. gate_assets created before assets
  it('creates gate_assets when entities exist', () => {
    const gdd = makeGdd({
      assetManifest: [makeAsset('Player model')],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const gateAssets = plan.approvalGates.find(g => g.id === 'gate_assets');

    expect(gateAssets).toBeDefined();
    expect(gateAssets!.status).toBe('pending');
  });

  // 7. gate_assets skipped when no entities (V4-6)
  it('skips gate_assets when there are no entities in any scene', () => {
    const gdd = makeGdd({
      scenes: [
        {
          name: 'EmptyScene',
          purpose: 'No entities',
          systems: [],
          entities: [],
          transitions: [],
        },
      ],
      assetManifest: [makeAsset('Background')],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const gateAssets = plan.approvalGates.find(g => g.id === 'gate_assets');

    expect(gateAssets).toBeUndefined();
  });

  // 8. Token estimate calculated correctly
  it('calculates token estimate from step executors', () => {
    const gdd = makeGdd({
      assetManifest: [makeAsset('Model 1'), makeAsset('Model 2')],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    // 2 asset_generate steps × 15 base tokens each = 30
    expect(plan.tokenEstimate.totalEstimated).toBeGreaterThanOrEqual(30);
    expect(plan.tokenEstimate.totalEstimated).toBeGreaterThan(0);
    expect(plan.tokenEstimate.breakdown.length).toBeGreaterThan(0);
  });

  // 9. Variance aggregation: sqrt(sum of variances^2)
  it('computes totalVarianceHigh as totalEstimated + sqrt(sum of squared variances)', () => {
    const gdd = makeGdd({
      assetManifest: [makeAsset('Model 1'), makeAsset('Model 2')],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const { totalEstimated, totalVarianceHigh, totalVarianceLow } = plan.tokenEstimate;

    expect(totalVarianceHigh).toBeGreaterThanOrEqual(totalEstimated);
    expect(totalVarianceLow).toBeLessThanOrEqual(totalEstimated);
    expect(totalVarianceLow).toBeGreaterThanOrEqual(0);
  });

  // 10. Insufficient balance: sufficientBalance=false, warningMessage set
  it('sets sufficientBalance=false and warningMessage when balance is too low', () => {
    const gdd = makeGdd({
      assetManifest: Array.from({ length: 5 }, (_, i) => makeAsset(`Asset ${i}`)),
    });

    // Total will be 5 * 15 = 75 tokens, give only 10
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10);
    expect(plan.tokenEstimate.sufficientBalance).toBe(false);
    expect(plan.tokenEstimate.warningMessage).toBeDefined();
  });

  // 11. stepCounter starts at -1 -> first ID step_0 (V4-1)
  it('assigns step_0 as the first step ID', () => {
    const gdd = makeGdd();
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    expect(plan.steps[0].id).toBe('step_0');
  });

  // 12. Unknown system categories -> custom_script_generate steps
  it('emits custom_script_generate step for unknown system categories', () => {
    const gdd = makeGdd({
      // 'narrative' has no entry in SYSTEM_REGISTRY, so it still falls through
      // to a generated script. 'challenge' and 'entities' used to sit here too
      // and no longer do: registering a category is exactly what REMOVES this
      // fall-through, so this fixture must name a category nothing plans.
      systems: [makeSystem('narrative', 'story-beats')],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const customScriptSteps = plan.steps.filter(
      s => s.executor === 'custom_script_generate',
    );

    expect(customScriptSteps.length).toBeGreaterThan(0);
    const step = customScriptSteps[0];
    expect(step.input).toMatchObject({ description: expect.stringContaining('narrative') });
  });

  // 13. FALLBACK_SCHEMA validates asset fallbacks
  it('keeps valid fallback strings as-is', () => {
    const gdd = makeGdd({
      assetManifest: [makeAsset('Valid fallback', 'required', 'primitive:sphere')],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const assetStep = plan.steps.find(s => s.executor === 'asset_generate')!;

    expect(assetStep).toBeDefined();
    expect(assetStep.input.fallback).toBe('primitive:sphere');
  });

  // 14. Invalid fallback -> 'primitive:cube'
  it('replaces invalid fallback strings with primitive:cube', () => {
    const gdd = makeGdd({
      assetManifest: [makeAsset('Bad fallback', 'required', 'INVALID_FALLBACK')],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const assetStep = plan.steps.find(s => s.executor === 'asset_generate')!;

    expect(assetStep).toBeDefined();
    expect(assetStep.input.fallback).toBe('primitive:cube');
  });

  // 15. Plan status starts as 'planning'
  it('returns plan with status planning', () => {
    const gdd = makeGdd();
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    expect(plan.status).toBe('planning');
  });

  // 16. Multiple scenes -> independent scene_create steps
  it('creates one scene_create step per scene', () => {
    const gdd = makeGdd({
      scenes: [
        {
          name: 'Scene1',
          purpose: 'First scene',
          systems: [],
          entities: [],
          transitions: [],
        },
        {
          name: 'Scene2',
          purpose: 'Second scene',
          systems: [],
          entities: [],
          transitions: [],
        },
        {
          name: 'Scene3',
          purpose: 'Third scene',
          systems: [],
          entities: [],
          transitions: [],
        },
      ],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const sceneSteps = plan.steps.filter(s => s.executor === 'scene_create');

    expect(sceneSteps).toHaveLength(3);
    // Each should have the correct scene name in input
    const sceneNames = sceneSteps.map(s => s.input.name);
    expect(sceneNames).toContain('Scene1');
    expect(sceneNames).toContain('Scene2');
    expect(sceneNames).toContain('Scene3');
  });

  it('handles duplicate entity names across different scenes without collision', () => {
    const gdd = makeGdd({
      scenes: [
        {
          name: 'Forest',
          purpose: 'outdoor level',
          systems: [],
          entities: [
            { name: 'Enemy', role: 'enemy' as const, systems: [], appearance: 'goblin' },
          ],
          transitions: [],
        },
        {
          name: 'Castle',
          purpose: 'indoor level',
          systems: [],
          entities: [
            { name: 'Enemy', role: 'enemy' as const, systems: [], appearance: 'knight' },
          ],
          transitions: [],
        },
      ],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const entitySteps = plan.steps.filter(s => s.executor === 'entity_setup');

    // Both entities should have their own steps (no overwrite)
    expect(entitySteps).toHaveLength(2);
    // Each depends on its own scene step (different scene step IDs)
    expect(entitySteps[0].dependsOn).not.toEqual(entitySteps[1].dependsOn);
  });

  // Additional: plan contains required top-level fields
  it('returns plan with required top-level fields', () => {
    const gdd = makeGdd();
    const plan = buildPlan(gdd, 'proj-42', 'hobbyist', 5000);

    expect(plan.id).toBeDefined();
    expect(typeof plan.id).toBe('string');
    expect(plan.projectId).toBe('proj-42');
    expect(plan.gdd).toBe(gdd);
    expect(plan.currentStepIndex).toBe(0);
    expect(plan.createdAt).toBeGreaterThan(0);
    // The `hobbyist` key is sold as "Starter" — capitalizing the key named a
    // plan ("Hobbyist tier") that appears on no pricing card.
    expect(plan.tokenEstimate.userTier).toBe(`${TIER_DISPLAY_NAMES.hobbyist} tier`);
  });

  // Additional: all steps have pending status
  it('all steps start with pending status', () => {
    const gdd = makeGdd({
      systems: [makeSystem('movement', 'platformer')],
      assetManifest: [makeAsset('Model')],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    for (const step of plan.steps) {
      expect(step.status).toBe('pending');
    }
  });

  // Additional: hobbyist cap = 15
  it('applies hobbyist tier cap of 15 assets', () => {
    const assets = Array.from({ length: 20 }, (_, i) => makeAsset(`Asset ${i}`, 'required'));
    const gdd = makeGdd({ assetManifest: assets });

    const plan = buildPlan(gdd, 'proj-1', 'hobbyist', 50000);
    const assetSteps = plan.steps.filter(s => s.executor === 'asset_generate');

    expect(assetSteps).toHaveLength(15);
  });

  // Additional: pro cap = 50
  it('applies pro tier cap of 50 assets', () => {
    const assets = Array.from({ length: 60 }, (_, i) => makeAsset(`Asset ${i}`, 'required'));
    const gdd = makeGdd({ assetManifest: assets });

    const plan = buildPlan(gdd, 'proj-1', 'pro', 100000);
    const assetSteps = plan.steps.filter(s => s.executor === 'asset_generate');

    expect(assetSteps).toHaveLength(50);
  });

  // Additional: gate_final always present
  it('always creates gate_final approval gate', () => {
    const gdd = makeGdd();
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    const gateFinal = plan.approvalGates.find(g => g.id === 'gate_final');
    expect(gateFinal).toBeDefined();
    expect(gateFinal!.status).toBe('pending');
  });

  // Additional: asset steps depend on all prior steps
  it('asset steps depend on all prior steps', () => {
    const gdd = makeGdd({
      assetManifest: [makeAsset('Player model')],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const assetStep = plan.steps.find(s => s.executor === 'asset_generate')!;
    const priorSteps = plan.steps
      .slice(0, plan.steps.indexOf(assetStep))
      .map(s => s.id);

    for (const priorId of priorSteps) {
      expect(assetStep.dependsOn).toContain(priorId);
    }
  });

  // Additional: nice-to-have assets are optional
  it('marks nice-to-have assets as optional steps', () => {
    const gdd = makeGdd({
      assetManifest: [
        makeAsset('Required model', 'required'),
        makeAsset('Nice to have sound', 'nice-to-have'),
      ],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const assetSteps = plan.steps.filter(s => s.executor === 'asset_generate');

    const requiredStep = assetSteps.find(s => s.input.description === 'Required model');
    const optionalStep = assetSteps.find(s => s.input.description === 'Nice to have sound');

    expect(requiredStep!.optional).toBe(false);
    expect(optionalStep!.optional).toBe(true);
  });

  // Additional: registered system categories produce their registry steps
  it('movement system produces physics_profile and character_setup steps', () => {
    const gdd = makeGdd({
      systems: [makeSystem('movement', 'platformer')],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const executors = plan.steps.map(s => s.executor);

    expect(executors).toContain('physics_profile');
    expect(executors).toContain('character_setup');
  });

  // A GDD is LLM-authored and nothing forces a movement system to come with a
  // player-role entity, so this shape is reachable. `character_setup` is a
  // non-optional step, and a non-optional step that fails sets the whole plan
  // to `failed` — the level, the collectibles and the win condition would all
  // be discarded to rig a character the design never named. Drop the step and
  // tell the user instead.
  it('drops character_setup and warns when a movement system has no player entity', () => {
    const gdd = makeGdd({
      systems: [makeSystem('movement', 'platformer')],
      scenes: [
        {
          name: 'Main',
          purpose: 'main',
          systems: [],
          entities: [
            { name: 'Crate', role: 'decoration', systems: [], appearance: 'box' },
          ],
          transitions: [],
        },
      ],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const gateFinal = plan.approvalGates.find(g => g.id === 'gate_final')!;
    const summary = gateFinal.displayData.completionSummary!;

    expect(plan.steps.map(s => s.executor)).not.toContain('character_setup');
    expect(plan.steps.map(s => s.executor)).toContain('physics_profile');
    expect(summary.warnings).toHaveLength(1);
    expect(summary.warnings[0]).toMatch(/player/i);
  });

  // The channel must stay quiet on the happy path — a warnings list that is
  // never empty is one users learn to ignore.
  it('leaves completionSummary.warnings empty when nothing was dropped', () => {
    const plan = buildPlan(
      makeGdd({ systems: [makeSystem('movement', 'platformer')] }),
      'proj-1',
      'creator',
      10000,
    );
    const gateFinal = plan.approvalGates.find(g => g.id === 'gate_final')!;
    const summary = gateFinal.displayData.completionSummary!;

    expect(summary.warnings).toEqual([]);
  });

  // ---------------------------------------------------------------------
  // Two systems may legitimately share a category — there are only 12
  // categories and a real game routinely wants more mechanics than that
  // (walk + swim, enemies + hazards). Neither may be silently dropped.
  // ---------------------------------------------------------------------

  it('builds steps for EVERY system sharing a category, not just the first', () => {
    const gdd = makeGdd({
      systems: [
        makeSystem('movement', 'platformer'),
        makeSystem('movement', 'swim'),
      ],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const systemTypes = plan.steps
      .filter(s => s.executor === 'physics_profile')
      .map(s => (s.input as { systemType?: string }).systemType);

    expect(systemTypes).toEqual(expect.arrayContaining(['platformer', 'swim']));
    expect(plan.steps.filter(s => s.executor === 'character_setup')).toHaveLength(2);
  });

  it('builds a custom_script step for every unknown-category system sharing that category', () => {
    const gdd = makeGdd({
      systems: [
        makeSystem('narrative', 'story-beats'),
        makeSystem('narrative', 'ambient-dialogue'),
      ],
      scenes: [
        {
          name: 'Main',
          purpose: 'Main gameplay scene',
          systems: [],
          entities: [
            {
              name: 'Player',
              role: 'player',
              systems: ['narrative'],
              appearance: 'capsule',
            },
          ],
          transitions: [],
        },
      ],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const scripts = plan.steps.filter(s => s.executor === 'custom_script_generate');

    expect(scripts).toHaveLength(2);
  });

  it('orders a duplicated category after the category it depends on', () => {
    // 'world' depends on 'movement'; both movement systems must still precede it.
    const gdd = makeGdd({
      systems: [
        makeSystem('world', 'terrain', 'core', ['movement']),
        makeSystem('movement', 'platformer'),
        makeSystem('movement', 'swim'),
      ],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const ids = plan.steps.map(s => s.id);
    const movementIdx = plan.steps
      .map((s, i) => (s.executor === 'character_setup' ? i : -1))
      .filter(i => i >= 0);
    const worldIdx = plan.steps.findIndex(
      s => (s.input as { worldType?: string }).worldType === 'terrain',
    );

    expect(movementIdx).toHaveLength(2);
    expect(worldIdx).toBeGreaterThan(-1);
    for (const mi of movementIdx) {
      expect(mi).toBeLessThan(worldIdx);
    }
    // Every dependency must name a step that appears earlier in the array,
    // or runPipeline skips it and fails the whole plan.
    for (let i = 0; i < plan.steps.length; i++) {
      for (const dep of plan.steps[i].dependsOn) {
        expect(ids.indexOf(dep)).toBeLessThan(i);
      }
    }
  });

  // ---------------------------------------------------------------------
  // Cycle detection — topoSortSystems must FAIL loudly, never silently
  // drop a step or hang, when gdd.systems has a cyclic dependsOn graph.
  // ---------------------------------------------------------------------

  it('throws an error naming both categories when two systems cyclically depend on each other', () => {
    const gdd = makeGdd({
      systems: [
        makeSystem('movement', 'walk', 'core', ['camera']),
        makeSystem('camera', 'follow', 'core', ['movement']),
      ],
    });

    expect(() => buildPlan(gdd, 'proj-1', 'creator', 10000)).toThrow(/movement/);
    expect(() => buildPlan(gdd, 'proj-1', 'creator', 10000)).toThrow(/camera/);
  });

  it('throws an error for a self-referencing system category', () => {
    const gdd = makeGdd({
      systems: [makeSystem('world', 'level', 'core', ['world'])],
    });

    expect(() => buildPlan(gdd, 'proj-1', 'creator', 10000)).toThrow(/world/);
  });

  it('throws an error for a 3-node cycle (movement -> camera -> world -> movement)', () => {
    const gdd = makeGdd({
      systems: [
        makeSystem('movement', 'walk', 'core', ['camera']),
        makeSystem('camera', 'follow', 'core', ['world']),
        makeSystem('world', 'level', 'core', ['movement']),
      ],
    });

    expect(() => buildPlan(gdd, 'proj-1', 'creator', 10000)).toThrow(/movement/);
  });

  it('does not throw for a non-cyclic diamond dependency graph', () => {
    const gdd = makeGdd({
      systems: [
        makeSystem('feedback', 'score', 'core', ['challenge']),
        makeSystem('challenge', 'combat', 'core', ['entities']),
        makeSystem('progression', 'levels', 'core', ['entities']),
        makeSystem('entities', 'spawner', 'core', []),
      ],
    });

    expect(() => buildPlan(gdd, 'proj-1', 'creator', 10000)).not.toThrow();
  });

  // ---------------------------------------------------------------------
  // AC2 — unknown system category binds targetEntityId, and only skips
  // the step when there is truly no entity anywhere in the GDD.
  // ---------------------------------------------------------------------

  it('binds targetEntityId to the entity that declares the unknown system category', () => {
    const gdd = makeGdd({
      systems: [makeSystem('narrative', 'dialogue')],
      scenes: [
        {
          name: 'Main',
          purpose: 'story scene',
          systems: [],
          entities: [
            { name: 'Bystander', role: 'npc', systems: [], appearance: 'human' },
            { name: 'Narrator', role: 'npc', systems: ['narrative'], appearance: 'ghost' },
          ],
          transitions: [],
        },
      ],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const step = plan.steps.find(s => s.executor === 'custom_script_generate')!;
    const narratorSetup = findEntitySetup(plan, 'Narrator');

    expect(step).toBeDefined();
    // The engine matches set_script on the EntityId component, never on
    // EntityName — so the binding must be the planned id, not the name.
    expect(step.input.targetEntityId).toBe(narratorSetup.input.entityId);
    expect(step.input.targetEntityId).not.toBe('Narrator');
    // The human name still travels alongside it, for the LLM prompt only.
    expect(step.input.targetEntityName).toBe('Narrator');
  });

  it('falls back to the first entity in the GDD when no entity declares the unknown category', () => {
    const gdd = makeGdd({
      // 'narrative' is unknown to SYSTEM_REGISTRY; default gdd's only entity
      // (Player) does not declare 'narrative' in its own systems list.
      systems: [makeSystem('narrative', 'story-beats')],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const step = plan.steps.find(s => s.executor === 'custom_script_generate')!;
    const playerSetup = findEntitySetup(plan, 'Player');

    expect(step).toBeDefined();
    expect(step.input.targetEntityId).toBe(playerSetup.input.entityId);
    expect(step.input.targetEntityName).toBe('Player');
  });

  // ---------------------------------------------------------------------
  // Entity identity: the plan mints the engine id up front so that every
  // downstream step binds to something the engine can actually resolve.
  // ---------------------------------------------------------------------

  it('gives every entity_setup step a distinct non-name entityId', () => {
    const gdd = makeGdd({
      scenes: [
        {
          name: 'Main',
          purpose: 'main',
          systems: [],
          entities: [
            { name: 'Player', role: 'player', systems: [], appearance: 'capsule' },
            { name: 'Enemy', role: 'enemy', systems: [], appearance: 'cube' },
          ],
          transitions: [],
        },
        {
          name: 'Boss',
          purpose: 'boss room',
          systems: [],
          // Same name in a different scene — must still get its own id.
          entities: [
            { name: 'Enemy', role: 'enemy', systems: [], appearance: 'cube' },
          ],
          transitions: [],
        },
      ],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const ids = plan.steps
      .filter(s => s.executor === 'entity_setup')
      .map(s => s.input.entityId as string);

    expect(ids).toHaveLength(3);
    for (const id of ids) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(['Player', 'Enemy']).not.toContain(id);
    }
    expect(new Set(ids).size).toBe(3);
  });

  // `character_setup` comes from the SYSTEM registry, not the entity loop, so
  // it used to carry no entity at all — the executor then fell back to the
  // designed name, which the engine's EntityId match never resolves. A
  // generated player silently received no CharacterController and could not
  // move. The plan already mints the id; it must reach the registry.
  it('binds character_setup to the planned player entity id', () => {
    const gdd = makeGdd({
      systems: [makeSystem('movement', 'platformer')],
      scenes: [
        {
          name: 'Main',
          purpose: 'main',
          systems: [],
          entities: [
            { name: 'Crate', role: 'decoration', systems: [], appearance: 'box' },
            { name: 'Knight', role: 'player', systems: [], appearance: 'armored' },
          ],
          transitions: [],
        },
      ],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const step = plan.steps.find(s => s.executor === 'character_setup')!;
    const knightSetup = findEntitySetup(plan, 'Knight');

    expect(step).toBeDefined();
    expect(step.input.entityId).toBe(knightSetup.input.entityId);
    expect(step.input.entityId).not.toBe('Knight');
    // The GDD's real player travels with it — the executor's own default is
    // named 'Player', so without this a store lookup searches the wrong name.
    expect((step.input.entity as { name: string }).name).toBe('Knight');
  });

  it('skips custom_script_generate for an unknown category when the GDD has zero entities anywhere', () => {
    const gdd = makeGdd({
      scenes: [
        { name: 'Empty', purpose: 'no entities', systems: [], entities: [], transitions: [] },
      ],
      systems: [makeSystem('narrative', 'story-beats')],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const customSteps = plan.steps.filter(s => s.executor === 'custom_script_generate');

    expect(customSteps).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // NB2 — gate afterStepId must wire to the step that the NEXT (dependent)
  // step actually depends on, not merely "some step near the gate". This
  // distinguishes "pause after the gated step" from "pause before the step
  // that depends on the gated step" — the off-by-one the naive reading gets
  // wrong.
  // ---------------------------------------------------------------------

  it('gate_assets.afterStepId equals exactly the LAST entity_setup step id (not any other prior step)', () => {
    // Asset steps depend on ALL prior steps by design (S2), so merely
    // asserting "the first asset step's dependsOn contains afterStepId"
    // is vacuously true for ANY prior step id and would not catch a
    // misrouted gate. Pin equality against an independently-computed
    // expected value instead.
    const gdd = makeGdd({
      scenes: [
        {
          name: 'Main',
          purpose: 'Main gameplay scene',
          systems: [],
          entities: [
            { name: 'First', role: 'player', systems: [], appearance: 'a' },
            { name: 'Second', role: 'enemy', systems: [], appearance: 'b' },
          ],
          transitions: [],
        },
      ],
      assetManifest: [makeAsset('Player model')],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const gateAssets = plan.approvalGates.find(g => g.id === 'gate_assets')!;
    const entitySteps = plan.steps.filter(s => s.executor === 'entity_setup');

    expect(entitySteps).toHaveLength(2);
    expect(gateAssets).toBeDefined();
    expect(gateAssets!.afterStepId).toBe(entitySteps[entitySteps.length - 1].id);
    // And it must NOT equal any earlier step (e.g. the plan_present step_0
    // or the first entity step) — the off-by-one the naive reading gets wrong.
    expect(gateAssets!.afterStepId).not.toBe('step_0');
    expect(gateAssets!.afterStepId).not.toBe(entitySteps[0].id);
  });

  it('wires gate_final.afterStepId so auto_polish (the very next step) depends on exactly it', () => {
    const gdd = makeGdd();
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    const gateFinal = plan.approvalGates.find(g => g.id === 'gate_final')!;
    const polishStep = plan.steps.find(s => s.executor === 'auto_polish')!;

    expect(polishStep.dependsOn).toEqual([gateFinal.afterStepId]);
  });

  // ---------------------------------------------------------------------
  // AC7 — every GDD fixture under __fixtures__/ must produce a valid plan
  // via buildPlan(): no throw, every dependsOn resolves to a real step id,
  // and every gate's afterStepId resolves to a real step id.
  // ---------------------------------------------------------------------

  describe('AC7 — fixture corpus', () => {
    const FIXTURES_DIR = path.resolve(__dirname, '../__fixtures__');
    const fixtureFiles = fs
      .readdirSync(FIXTURES_DIR)
      .filter(f => f.endsWith('.json'))
      .sort();

    // Fail closed on an empty or thinned corpus: a directory that stopped
    // resolving would make `it.each` register zero cases and report green.
    // A floor rather than an exact count — deleting a fixture still trips it,
    // but adding a 13th does not fail a test that has nothing to do with it.
    it('enumerates the full fixture corpus', () => {
      expect(fixtureFiles.length).toBeGreaterThanOrEqual(12);
    });

    it.each(fixtureFiles)(
      'produces a plan with resolvable executors and dependsOn chains: %s',
      (file) => {
        const raw = fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf-8');
        const gdd = JSON.parse(raw) as OrchestratorGDD;

        let plan: ReturnType<typeof buildPlan> | undefined;
        expect(() => {
          plan = buildPlan(gdd, 'proj-fixture', 'pro', 1_000_000);
        }).not.toThrow();

        expect(plan!.steps.length).toBeGreaterThan(0);

        const stepIds = new Set(plan!.steps.map(s => s.id));
        // Every dependsOn reference must resolve to an actual step in the plan.
        for (const step of plan!.steps) {
          for (const dep of step.dependsOn) {
            expect(stepIds.has(dep)).toBe(true);
          }
        }
        // Every gate's afterStepId must resolve to an actual step in the plan.
        for (const gate of plan!.approvalGates) {
          expect(stepIds.has(gate.afterStepId)).toBe(true);
        }
      },
    );
  });
});

/**
 * The plan-level win-condition guarantee.
 *
 * `progression.ts` is the only system definition that plans a `winCondition`,
 * and it runs ONLY when the GDD declares a system whose category is
 * 'progression'. Most GDDs do not declare one — so without a guarantee here the
 * plan carries no win condition at all, `validateWinnability` answers
 * NO_WIN_CONDITION, and `gameSlice.play()` returns before it dispatches
 * anything. A generated game that cannot be played is the whole failure this
 * work exists to remove, so the guarantee belongs in the builder rather than in
 * any one system definition.
 */
describe('buildPlan — the win-condition guarantee', () => {
  /** Every `game_component` step planning a win condition, read by index. */
  function winConditionSteps(plan: {
    steps: Array<{ executor: string; input: Record<string, unknown> }>;
  }) {
    const found: Array<Record<string, unknown>> = [];
    // Indexed reads, never `.filter`: it skips array holes, so a sparse step
    // list would report itself clean.
    for (let i = 0; i < plan.steps.length; i += 1) {
      const step = plan.steps[i];
      if (!step) continue;
      if (step.executor === 'game_component' && step.input.type === 'winCondition') {
        found.push(step.input);
      }
    }
    return found;
  }

  function warningsOf(plan: ReturnType<typeof buildPlan>): string[] {
    return plan.approvalGates.find(g => g.id === 'gate_final')!.displayData.completionSummary!
      .warnings;
  }

  it('plans a satisfiable win condition for a GDD that declares no progression system', () => {
    const gdd = makeGdd({ systems: [makeSystem('movement', 'platformer')] });
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    const conditions = winConditionSteps(plan);
    expect(conditions).toHaveLength(1);
    expect(conditions[0].conditionType).toBe('score');
    // A score condition is winnable only with a positive finite target — the
    // validator refuses zero, negative and non-finite alike.
    const target = conditions[0].targetScore as number;
    expect(Number.isFinite(target)).toBe(true);
    expect(target).toBeGreaterThan(0);
  });

  it('binds the substituted condition to the player by engine id, never by name', () => {
    const gdd = makeGdd({ systems: [makeSystem('movement', 'platformer')] });
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    const playerId = (findEntitySetup(plan, 'Player').input as { entityId: string }).entityId;
    expect(typeof playerId).toBe('string');
    expect(playerId.length).toBeGreaterThan(0);
    expect(winConditionSteps(plan)[0].entityId).toBe(playerId);
  });

  /**
   * Supplying a default is not the same as dropping something the user asked
   * for. The warnings channel means "your design lost something", and a channel
   * that speaks on every ordinary plan is one users stop reading — so the
   * ordinary substitution stays silent, and `buildPlan`'s existing
   * "quiet on the happy path" test stays true.
   */
  it('stays silent for the ordinary substitution — a default is not a dropped feature', () => {
    const gdd = makeGdd({ systems: [makeSystem('movement', 'platformer')] });
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    expect(winConditionSteps(plan)).toHaveLength(1);
    expect(warningsOf(plan)).toEqual([]);
  });

  /**
   * The guarantee must DEFER to a real progression system, never double up: two
   * win conditions on one scene is a second rule the player was never told
   * about.
   */
  it('does not add a second condition when a progression system already planned one', () => {
    const gdd = makeGdd({
      systems: [makeSystem('movement', 'platformer'), makeSystem('progression', 'score-attack')],
    });
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    expect(winConditionSteps(plan)).toHaveLength(1);
  });

  /**
   * Verification has to run AFTER the substituted condition exists, or it would
   * check a scene the plan had not finished describing and report a break the
   * plan itself was about to fix.
   */
  it('runs verification after the substituted condition, not before it', () => {
    const gdd = makeGdd({ systems: [makeSystem('movement', 'platformer')] });
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    let winStepId = '';
    let verifyStep: { dependsOn: string[] } | undefined;
    for (let i = 0; i < plan.steps.length; i += 1) {
      const step = plan.steps[i];
      if (step.executor === 'game_component' && step.input.type === 'winCondition') {
        winStepId = step.id;
      }
      if (step.executor === 'verify_all_scenes') verifyStep = step;
    }

    expect(winStepId).not.toBe('');
    expect(verifyStep?.dependsOn).toContain(winStepId);
  });

  it('spawns a component target before planning a rule for it', () => {
    const gdd = makeGdd({ systems: [makeSystem('movement', 'platformer')] });
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    const componentIndex = plan.steps.findIndex(
      step => step.executor === 'game_component' && step.input.type === 'winCondition',
    );
    expect(componentIndex).toBeGreaterThanOrEqual(0);

    const entityId = plan.steps[componentIndex].input.entityId;
    const spawnIndex = plan.steps.findIndex(
      step => step.executor === 'entity_setup' && step.input.entityId === entityId,
    );

    // gameComponentExecutor validates against the live scene graph. If this
    // order reverses, the rule fails ENTITY_NOT_FOUND even though both steps
    // exist in the plan.
    expect(spawnIndex).toBeGreaterThanOrEqual(0);
    expect(spawnIndex).toBeLessThan(componentIndex);
  });

  /**
   * A GDD with no entities anywhere has nothing to carry the component. THIS is
   * a real loss rather than a default, so it speaks — and it must not emit a
   * step bound to an empty id, which the engine would reject and which would
   * fail the whole plan.
   */
  it('warns instead of planning an unbound condition when there is nothing to bind to', () => {
    const gdd = makeGdd({
      systems: [makeSystem('movement', 'platformer')],
      scenes: [{ name: 'Main', purpose: 'Empty', systems: [], entities: [], transitions: [] }],
    });
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    expect(winConditionSteps(plan)).toHaveLength(0);
    expect(warningsOf(plan).join(' ')).toMatch(/no goal yet/i);
  });
});


// ---------------------------------------------------------------------------
// Phase 2.5 — physics enablement (PF-1213)
// ---------------------------------------------------------------------------

/**
 * `planBuilder` decides, at plan time, which spawned entities get a physical
 * body. Nothing downstream can cover for a wrong decision here: the engine
 * attaches a Rapier collider only to an entity carrying `PhysicsEnabled`, so an
 * entity this phase drops is one the player walks straight through for the rest
 * of the game's life — no error, no warning, no failed step.
 *
 * The step's shape is load-bearing in both directions. Too FEW entities and the
 * game silently loses collisions; too many and a `decoration` (the GDD files the
 * camera rig and the key light under that role) gets an invisible one-metre wall
 * at the origin. An EMPTY list is worse than either: the executor's schema is
 * `min(1)`, so a step planned with no entities fails `INVALID_INPUT` and takes
 * the run with it.
 *
 * These assert on the full step input with `toEqual` rather than
 * `objectContaining`, because the invented-or-missing key IS the defect class
 * here (PF-1213): `objectContaining` is blind to a field sitting alongside the
 * ones it names.
 */
describe('buildPlan — physics enablement step (PF-1213)', () => {
  /** The single `physics_enable` step, or `undefined` when none was planned. */
  function physicsEnableStep(plan: { steps: Array<{ executor: string }> }) {
    const found = plan.steps.filter(s => s.executor === 'physics_enable');
    // More than one would mean a second producer appeared (systems/world.ts
    // plans its own for ground/platforms), which would make every assertion
    // below ambiguous about which step it is grading.
    expect(found.length, 'expected at most one physics_enable step in this plan').toBeLessThan(2);
    return found[0] as
      | { id: string; executor: string; input: Record<string, unknown>; dependsOn: string[] }
      | undefined;
  }

  it('names every bodied entity — and only those — with its spawned shape', () => {
    const gdd = makeGdd({
      scenes: [
        {
          name: 'Main',
          purpose: 'Main gameplay scene',
          systems: [],
          entities: [
            { name: 'Player', role: 'player', systems: [], appearance: 'primitive:sphere' },
            { name: 'Crystal', role: 'interactable', systems: [], appearance: 'a glowing shard' },
            // Bodyless on purpose: a collider here is an invisible wall.
            { name: 'KeyLight', role: 'decoration', systems: [], appearance: 'primitive:cube' },
          ],
          transitions: [],
        },
      ],
    });
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    const playerId = (findEntitySetup(plan, 'Player').input as { entityId: string }).entityId;
    const crystalId = (findEntitySetup(plan, 'Crystal').input as { entityId: string }).entityId;
    const step = physicsEnableStep(plan);

    expect(step).toBeDefined();
    // Full-payload equality: an extra key the executor's schema does not know,
    // or a shape that disagrees with what `entity_setup` spawns, is exactly the
    // failure `objectContaining` would wave through.
    expect(step?.input).toEqual({
      entities: [
        // `primitive:sphere` is honoured, so the collider matches the mesh.
        { entityId: playerId, name: 'Player', role: 'player', shape: 'sphere' },
        // Prose appearance is not a primitive directive, so the role default
        // (`interactable` -> cube) stands.
        { entityId: crystalId, name: 'Crystal', role: 'interactable', shape: 'cube' },
      ],
    });
  });

  it('waits for every entity in the plan, not just the ones it names', () => {
    const gdd = makeGdd({
      scenes: [
        {
          name: 'Main',
          purpose: 'Main gameplay scene',
          systems: [],
          entities: [
            { name: 'Player', role: 'player', systems: [], appearance: 'capsule' },
            { name: 'KeyLight', role: 'decoration', systems: [], appearance: 'primitive:cube' },
          ],
          transitions: [],
        },
      ],
    });
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    const entityStepIds = plan.steps
      .filter(s => s.executor === 'entity_setup')
      .map(s => s.id);
    const step = physicsEnableStep(plan);

    expect(entityStepIds).toHaveLength(2);
    // The bodyless decoration's step is a dependency too. `toggle_physics`
    // against an entity the engine has not spawned yet is a silent no-op, and
    // the spawns run in one batch — so the gate is "all entities exist", not
    // "the ones this step names exist".
    expect(step?.dependsOn).toEqual(entityStepIds);
  });

  it('plans no step at all when every entity is bodyless', () => {
    const gdd = makeGdd({
      scenes: [
        {
          name: 'Main',
          purpose: 'Set dressing only',
          systems: [],
          entities: [
            { name: 'KeyLight', role: 'decoration', systems: [], appearance: 'primitive:cube' },
            { name: 'CameraRig', role: 'decoration', systems: [], appearance: 'primitive:cube' },
          ],
          transitions: [],
        },
      ],
    });
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    // An empty `entities` list fails the executor's `min(1)` schema with
    // INVALID_INPUT, and a non-optional step failing fails the whole run — so
    // "nothing to enable" must plan nothing, not an empty step.
    expect(physicsEnableStep(plan)).toBeUndefined();
  });

  it('makes system steps wait for the bodies they tune', () => {
    const gdd = makeGdd({ systems: [makeSystem('movement', 'platformer')] });
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    const step = physicsEnableStep(plan);
    const systemSteps = plan.steps.filter(s => s.executor === 'character_setup');

    expect(step).toBeDefined();
    expect(systemSteps.length).toBeGreaterThan(0);
    // `character_setup` rigs a controller onto a body, and `physics_profile`
    // tunes gravity scale, friction and restitution on one. Either running
    // first patches a component that does not exist yet, which
    // `apply_physics_updates` drops in silence.
    for (let i = 0; i < systemSteps.length; i += 1) {
      expect(
        systemSteps[i].dependsOn,
        `${systemSteps[i].executor} does not wait for physics_enable`,
      ).toContain(step?.id);
    }
  });

  it('costs the user nothing — it is pure engine dispatch', () => {
    const gdd = makeGdd({
      scenes: [
        {
          name: 'Main',
          purpose: 'Main gameplay scene',
          systems: [],
          entities: [
            { name: 'Player', role: 'player', systems: [], appearance: 'capsule' },
            { name: 'Crystal', role: 'interactable', systems: [], appearance: 'primitive:sphere' },
          ],
          transitions: [],
        },
      ],
    });
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const engineOps = plan.tokenEstimate.breakdown.find(b => b.category === 'Engine operations');

    expect(physicsEnableStep(plan)).toBeDefined();
    // Exactly the priced steps this plan contains — two `entity_setup`s and the
    // closing `auto_polish` — and not a token more. The estimate is quoted to
    // the user before they approve the plan, so a step that secretly carried a
    // price would overstate the build. Derived from the pricing table rather
    // than a literal, so a price change moves the expectation with it.
    expect(engineOps?.estimatedTokens).toBe(
      TOKEN_COSTS.plan_entity_setup * 2 + TOKEN_COSTS.plan_auto_polish,
    );
  });

  /**
   * The behavioural test above cannot tell a registered zero-cost entry from a
   * MISSING one — `PLAN_COST_ESTIMATES[step.executor] ?? { base: 0, variance: 0 }`
   * makes the two indistinguishable at runtime, and the map is module-private so
   * there is nothing to import. Reading the source is the only way to pin that
   * the executor was priced deliberately rather than defaulted by accident; an
   * unpriced executor is how a later non-zero price gets quoted as free.
   */
  it('prices physics_enable explicitly rather than falling through to the default', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../planBuilder.ts'),
      'utf-8',
    );

    // Fail closed: an unreadable or truncated file must not pass vacuously.
    expect(source.length).toBeGreaterThan(1000);
    expect(source).toContain('const PLAN_COST_ESTIMATES');

    const table = source.slice(source.indexOf('const PLAN_COST_ESTIMATES'));
    const end = table.indexOf('\n};');
    expect(end).toBeGreaterThan(0);

    expect(table.slice(0, end)).toMatch(/^\s*physics_enable:\s*\{/m);
  });
});

/**
 * Phase 3a — the deferred movement feel pass.
 *
 * `physics_profile` finds the bodies it tunes through
 * `resolveStepOutputs('physics_enable')`, which can only report steps that have
 * ALREADY run. Two `physics_enable` steps exist on a full plan (the Phase 2.5
 * cast, and the one `systems/world.ts` plans for the geometry it mints), and
 * `topoSortSystems` imposes no order between `world` and `movement` — both are
 * `core`, so the order is whatever the GDD happened to list.
 *
 * The integration test exercises exactly one of those shapes: the
 * `crystalRun3d()` fixture, which lists movement first. That fixture passing
 * says nothing about the other shapes, so a regression that re-inlined the feel
 * pass into the systems loop would only be caught if the fixture's own GDD
 * order happened to expose it. These cases pin the invariant directly, over the
 * plan shapes the fixture does not have.
 */
describe('buildPlan — the deferred feel pass (PF-1226)', () => {
  type PlanStep = { id: string; executor: string; dependsOn: string[] };

  /** Array positions of every step with this executor. Position IS the run order. */
  function indicesOf(plan: { steps: PlanStep[] }, executor: string): number[] {
    const out: number[] = [];
    for (let i = 0; i < plan.steps.length; i += 1) {
      if (plan.steps[i].executor === executor) out.push(i);
    }
    return out;
  }

  function stepsOf(plan: { steps: PlanStep[] }, executor: string): PlanStep[] {
    const out: PlanStep[] = [];
    for (let i = 0; i < plan.steps.length; i += 1) {
      if (plan.steps[i].executor === executor) out.push(plan.steps[i]);
    }
    return out;
  }

  /**
   * The whole invariant, in the two halves that each fail differently.
   *
   * ORDER is what makes the feel pass see the bodies at all — `runPipeline`
   * executes in array order, so a profile step sitting before an enablement
   * step resolves nothing for it and that geometry keeps default friction in
   * silence. DEPENDSON is what makes a failed enablement stop the pass instead
   * of half-tuning the scene; it only gates, it never reorders.
   */
  function feelPassShape(plan: { steps: PlanStep[] }) {
    const enableIndices = indicesOf(plan, 'physics_enable');
    const feelIndices = indicesOf(plan, 'physics_profile');
    const enableSteps = stepsOf(plan, 'physics_enable');
    const feelSteps = stepsOf(plan, 'physics_profile');

    return {
      // Fail closed: a plan that stopped planning either step would satisfy
      // "every profile is after every enable" vacuously, so the counts are
      // part of the asserted shape rather than a separate precondition.
      enableCount: enableIndices.length,
      feelCount: feelIndices.length,
      // `runPipeline` executes in array order, so a profile step sitting
      // before an enablement step resolves nothing for it and that geometry
      // keeps default friction in silence.
      feelStepsRunningBeforeAnEnable: feelSteps
        .filter((_, f) => enableIndices.some((e) => feelIndices[f] < e))
        .map((step) => step.id),
      // dependsOn is what makes a failed enablement stop the pass instead of
      // half-tuning the scene; it only gates, it never reorders.
      feelStepsNotGatedOnEveryEnable: feelSteps
        .filter((step) => enableSteps.some((enable) => !step.dependsOn.includes(enable.id)))
        .map((step) => step.id),
    };
  }

  /** The shape a correct plan has, whatever the step counts are. */
  const feelPassIsCorrect = {
    feelStepsRunningBeforeAnEnable: [],
    feelStepsNotGatedOnEveryEnable: [],
  };

  it('holds when the GDD lists world BEFORE movement', () => {
    const gdd = makeGdd({
      systems: [makeSystem('world', 'platformer'), makeSystem('movement', 'platformer')],
    });
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    // Two enablement steps: the Phase 2.5 cast, and the geometry `world` mints.
    expect(feelPassShape(plan)).toEqual({ enableCount: 2, feelCount: 1, ...feelPassIsCorrect });
  });

  it('holds when the GDD lists movement BEFORE world', () => {
    const gdd = makeGdd({
      systems: [makeSystem('movement', 'platformer'), makeSystem('world', 'platformer')],
    });
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    // The shape the `crystalRun3d()` fixture happens to have, asserted here so
    // the pair is visible: the invariant must not depend on GDD listing order.
    expect(feelPassShape(plan)).toEqual({ enableCount: 2, feelCount: 1, ...feelPassIsCorrect });
  });

  it('holds when there is no world system at all', () => {
    const gdd = makeGdd({ systems: [makeSystem('movement', 'platformer')] });
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    // Only the Phase 2.5 enablement exists. The deferral must still apply —
    // an implementation that deferred only when a second enablement was
    // present would pass every other case here.
    expect(feelPassShape(plan)).toEqual({ enableCount: 1, feelCount: 1, ...feelPassIsCorrect });
  });

  it('holds for every feel pass when the GDD declares several movement systems', () => {
    const gdd = makeGdd({
      systems: [
        makeSystem('movement', 'platformer'),
        makeSystem('world', 'platformer'),
        makeSystem('movement', 'topdown'),
      ],
    });
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    // An LLM-authored GDD can name the category twice, and each one plans its
    // own feel pass. Deferring the first and inlining the rest would leave the
    // second tuning geometry that has not been enabled yet.
    expect(feelPassShape(plan)).toEqual({ enableCount: 2, feelCount: 2, ...feelPassIsCorrect });
  });

  it('runs the feel pass after the character rig it now merges onto', () => {
    const gdd = makeGdd({
      systems: [makeSystem('world', 'platformer'), makeSystem('movement', 'platformer')],
    });
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    const feelIndices = indicesOf(plan, 'physics_profile');
    const rigIndices = indicesOf(plan, 'character_setup');

    expect(feelIndices).toHaveLength(1);
    expect(rigIndices).toHaveLength(1);
    // The deferral reversed this pair, which is what makes `applyPhysicsProfile`
    // find a live CharacterController and re-dispatch `update_game_component`
    // onto it. The executor comments describe that order; this pins it.
    expect(feelIndices[0]).toBeGreaterThan(rigIndices[0]);
  });

  it('does not register the feel pass as the movement category\'s step', () => {
    const gdd = makeGdd({
      systems: [
        makeSystem('movement', 'platformer'),
        makeSystem('camera', 'thirdPerson', 'core', ['movement']),
      ],
    });
    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);

    const feelSteps = stepsOf(plan, 'physics_profile');
    const cameraSteps = stepsOf(plan, 'camera_setup');

    expect(feelSteps).toHaveLength(1);
    expect(cameraSteps.length).toBeGreaterThan(0);
    // A system declaring `dependsOn: ['movement']` means the character rig,
    // which still sits in Phase 3. Gating it on the feel pass instead would
    // push it after a step that now runs at the very end of the phase — and
    // `dependsOn` does not reorder, so the camera step would be reached with
    // an unmet dependency, marked `skipped`, and fail the whole plan.
    for (let i = 0; i < cameraSteps.length; i += 1) {
      expect(cameraSteps[i].dependsOn).not.toContain(feelSteps[0].id);
    }
  });
});
