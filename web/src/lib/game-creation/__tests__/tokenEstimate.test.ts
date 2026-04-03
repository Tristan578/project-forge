/**
 * U5 — Token Estimate Tests
 *
 * Verifies that buildPlan() produces correct token estimates including:
 * - Zero assets → minimal total
 * - N asset steps → totalEstimated includes N * 15 tokens
 * - Variance aggregation uses sqrt(sum of squares)
 * - Insufficient balance produces a warningMessage
 * - Sufficient balance has sufficientBalance=true
 *
 * Token costs per executor (from planBuilder.ts TOKEN_COSTS):
 *   asset_generate:        base=15, variance=0.4
 *   custom_script_generate: base=8, variance=0.3
 *   auto_polish:            base=5, variance=0.2
 *   all others:             base=0, variance=0
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { OrchestratorGDD } from '@/lib/game-creation/types';
import { buildPlan } from '@/lib/game-creation/planBuilder';

// Ensure the SYSTEM_REGISTRY side-effects are loaded
import '@/lib/game-creation/systems';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMinimalGdd(overrides: Partial<OrchestratorGDD> = {}): OrchestratorGDD {
  return {
    id: 'test-gdd',
    title: 'Token Test Game',
    description: 'A minimal GDD for token estimation tests',
    systems: [],
    scenes: [
      {
        name: 'Main',
        purpose: 'Minimal scene with no entities',
        systems: [],
        entities: [],
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

function makeAssetNeed(index: number) {
  return {
    type: 'texture' as const,
    description: `Test texture ${index}`,
    styleDirective: 'minimal',
    priority: 'required' as const,
    fallback: `primitive:asset-${index}`,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Token Estimation (U5)', () => {
  describe('empty GDD (0 assets, 0 systems)', () => {
    it('produces a totalEstimated of only fixed steps (verify=0, polish=5)', () => {
      const gdd = makeMinimalGdd();
      const plan = buildPlan(gdd, 'proj-1', 'creator', 10_000);

      // Only auto_polish (base=5) and verify_all_scenes (base=0) contribute
      // scene_create: 0, entity_setup: 0 (no entities), verify: 0, polish: 5
      expect(plan.tokenEstimate.totalEstimated).toBe(5);
    });

    it('has sufficientBalance=true with a large token balance', () => {
      const gdd = makeMinimalGdd();
      const plan = buildPlan(gdd, 'proj-1', 'creator', 10_000);
      expect(plan.tokenEstimate.sufficientBalance).toBe(true);
    });

    it('produces no warningMessage when balance is large', () => {
      const gdd = makeMinimalGdd();
      const plan = buildPlan(gdd, 'proj-1', 'creator', 10_000);
      expect(plan.tokenEstimate.warningMessage).toBeUndefined();
    });
  });

  describe('5 asset steps', () => {
    let assetTokens: number;

    beforeAll(() => {
      // 5 assets * 15 tokens each = 75 asset tokens
      assetTokens = 5 * 15;
    });

    it('totalEstimated includes 5 * 15 = 75 tokens from assets', () => {
      const assets = Array.from({ length: 5 }, (_, i) => makeAssetNeed(i));
      const gdd = makeMinimalGdd({ assetManifest: assets });
      const plan = buildPlan(gdd, 'proj-1', 'creator', 10_000);

      // asset_generate contributes 75 tokens, auto_polish contributes 5
      expect(plan.tokenEstimate.totalEstimated).toBe(assetTokens + 5);
    });

    it('breakdown contains an "Asset creation" entry with estimatedTokens = 75', () => {
      const assets = Array.from({ length: 5 }, (_, i) => makeAssetNeed(i));
      const gdd = makeMinimalGdd({ assetManifest: assets });
      const plan = buildPlan(gdd, 'proj-1', 'creator', 10_000);

      const assetBreakdown = plan.tokenEstimate.breakdown.find(
        b => b.category === 'Asset creation',
      );
      expect(assetBreakdown).toBeDefined();
      expect(assetBreakdown!.estimatedTokens).toBe(assetTokens);
    });

    it('totalVarianceHigh > totalEstimated (variance is strictly positive)', () => {
      const assets = Array.from({ length: 5 }, (_, i) => makeAssetNeed(i));
      const gdd = makeMinimalGdd({ assetManifest: assets });
      const plan = buildPlan(gdd, 'proj-1', 'creator', 10_000);

      expect(plan.tokenEstimate.totalVarianceHigh).toBeGreaterThan(
        plan.tokenEstimate.totalEstimated,
      );
    });
  });

  describe('variance aggregation uses sqrt(sum of squares)', () => {
    it('3 assets: combined variance = sqrt(sum of squared step variances)', () => {
      const assets = Array.from({ length: 3 }, (_, i) => makeAssetNeed(i));
      const gdd = makeMinimalGdd({ assetManifest: assets });
      const plan = buildPlan(gdd, 'proj-1', 'creator', 10_000);

      // Each asset_generate step: base=15, variance=0.4 → per-step variance = 15 * 0.4 = 6
      // 3 steps: varianceSumSq = 3 * (6^2) = 108
      // combinedAbsVariance = sqrt(108) ≈ 10.392
      // Also auto_polish: base=5, variance=0.2 → 5*0.2=1, varianceSumSq += 1
      // Engine ops varianceSumSq = 0 (scene_create, verify_all_scenes)
      // Total abs variance = sqrt(3*36 + 1) = sqrt(109) ≈ 10.44

      // assetVarianceSumSq = 3 * (15 * 0.4)^2 = 3 * 36 = 108
      // polishVarianceSumSq = (5 * 0.2)^2 = 1
      // totalAbsVariance = sqrt(108 + 1) = sqrt(109)
      const expectedTotalAbsVariance = Math.sqrt(3 * Math.pow(15 * 0.4, 2) + Math.pow(5 * 0.2, 2));
      const expectedHigh = Math.round(plan.tokenEstimate.totalEstimated + expectedTotalAbsVariance);
      const expectedLow = Math.round(Math.max(0, plan.tokenEstimate.totalEstimated - expectedTotalAbsVariance));

      expect(plan.tokenEstimate.totalVarianceHigh).toBe(expectedHigh);
      expect(plan.tokenEstimate.totalVarianceLow).toBe(expectedLow);
    });

    it('category-level variance is a fraction of category total tokens', () => {
      const assets = Array.from({ length: 2 }, (_, i) => makeAssetNeed(i));
      const gdd = makeMinimalGdd({ assetManifest: assets });
      const plan = buildPlan(gdd, 'proj-1', 'creator', 10_000);

      const assetBreakdown = plan.tokenEstimate.breakdown.find(
        b => b.category === 'Asset creation',
      );
      expect(assetBreakdown).toBeDefined();
      // variance is combinedAbsVariance / totalTokens — must be > 0 and < 1
      expect(assetBreakdown!.variance).toBeGreaterThan(0);
      expect(assetBreakdown!.variance).toBeLessThan(1);
    });
  });

  describe('insufficient balance produces warningMessage', () => {
    it('balance = 0: produces warningMessage about token percentage', () => {
      const assets = Array.from({ length: 3 }, (_, i) => makeAssetNeed(i));
      const gdd = makeMinimalGdd({ assetManifest: assets });
      // Token balance of 0 means pctOfBalance = 100 (>80), triggers warning
      const plan = buildPlan(gdd, 'proj-1', 'creator', 0);

      expect(plan.tokenEstimate.warningMessage).toBeDefined();
      expect(plan.tokenEstimate.warningMessage).toContain('%');
    });

    it('balance = 10 with many assets: produces warningMessage', () => {
      const assets = Array.from({ length: 5 }, (_, i) => makeAssetNeed(i));
      const gdd = makeMinimalGdd({ assetManifest: assets });
      // totalEstimated = 75 + 5 = 80; balance = 10 → pctOfBalance = 800% (>80)
      const plan = buildPlan(gdd, 'proj-1', 'creator', 10);

      expect(plan.tokenEstimate.warningMessage).toBeDefined();
    });

    it('balance = 0: sufficientBalance is false when totalVarianceHigh > 0', () => {
      const assets = [makeAssetNeed(0)];
      const gdd = makeMinimalGdd({ assetManifest: assets });
      const plan = buildPlan(gdd, 'proj-1', 'creator', 0);

      // totalVarianceHigh > 0 (15 base + variance), so balance=0 < totalVarianceHigh
      expect(plan.tokenEstimate.sufficientBalance).toBe(false);
    });
  });

  describe('sufficient balance', () => {
    it('sufficientBalance=true when balance > totalVarianceHigh', () => {
      const gdd = makeMinimalGdd();
      const plan = buildPlan(gdd, 'proj-1', 'creator', 10_000);

      // totalVarianceHigh for minimal GDD ≈ 5 + small variance from polish
      // 10_000 >> 5, so sufficientBalance must be true
      expect(plan.tokenEstimate.sufficientBalance).toBe(true);
    });

    it('no warningMessage when total is well below balance', () => {
      const gdd = makeMinimalGdd();
      const plan = buildPlan(gdd, 'proj-1', 'creator', 10_000);
      // 5 tokens / 10_000 balance = 0.05% → well below 50% threshold
      expect(plan.tokenEstimate.warningMessage).toBeUndefined();
    });

    it('userTier in estimate reflects the tier label format', () => {
      const gdd = makeMinimalGdd();
      const plan = buildPlan(gdd, 'proj-1', 'pro', 10_000);

      expect(plan.tokenEstimate.userTier).toBe('Pro tier');
    });
  });

  describe('tier caps affect asset count and thus token total', () => {
    it('starter tier caps at 5 assets even if manifest has more', () => {
      // starter cap = 5, we give it 10 assets
      const assets = Array.from({ length: 10 }, (_, i) => makeAssetNeed(i));
      const gdd = makeMinimalGdd({ assetManifest: assets });
      const plan = buildPlan(gdd, 'proj-1', 'starter', 10_000);

      // Only 5 assets processed: 5 * 15 = 75 + polish 5 = 80
      expect(plan.tokenEstimate.totalEstimated).toBe(80);
    });

    it('pro tier allows up to 50 assets', () => {
      const assets = Array.from({ length: 30 }, (_, i) => makeAssetNeed(i));
      const gdd = makeMinimalGdd({ assetManifest: assets });
      const plan = buildPlan(gdd, 'proj-1', 'pro', 100_000);

      // 30 assets all included (under pro cap of 50): 30 * 15 = 450 + polish 5 = 455
      expect(plan.tokenEstimate.totalEstimated).toBe(455);
    });
  });
});
