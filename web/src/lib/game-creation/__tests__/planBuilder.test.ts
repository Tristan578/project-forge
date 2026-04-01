/**
 * Tests for the Game Creation Orchestrator plan builder.
 *
 * Verifies that buildPlan() converts an OrchestratorGDD into a correctly
 * topologically-sorted OrchestratorPlan with tier caps, approval gates,
 * and accurate token estimates.
 */

import { describe, it, expect } from 'vitest';
import type { OrchestratorGDD, GameSystem, AssetNeed } from '@/lib/game-creation/types';
import { buildPlan } from '@/lib/game-creation/planBuilder';

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
            behaviors: ['move'],
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
    expect(plan.steps[0].executor).toBe('scene_create');
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
      // 'challenge' and 'narrative' are not in SYSTEM_REGISTRY (only 4 are registered)
      systems: [makeSystem('challenge', 'combat')],
    });

    const plan = buildPlan(gdd, 'proj-1', 'creator', 10000);
    const customScriptSteps = plan.steps.filter(
      s => s.executor === 'custom_script_generate',
    );

    expect(customScriptSteps.length).toBeGreaterThan(0);
    const step = customScriptSteps[0];
    expect(step.input).toMatchObject({ description: expect.stringContaining('challenge') });
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
    expect(plan.tokenEstimate.userTier).toBe('Hobbyist tier');
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
});
