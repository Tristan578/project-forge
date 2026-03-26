import { describe, it, expect } from 'vitest';
import { zSystemCategory, FALLBACK_SCHEMA } from '../types';
import type {
  GameSystem,
  PlanStep,
  ExecutorName,
  SystemCategory,
  FeelDirective,
  SceneBlueprint,
  EntityBlueprint,
  AssetNeed,
  OrchestratorPlan,
  TokenEstimate,
  ExecutorResult,
} from '../types';

describe('game-creation/types — Phase 2A Layer 1', () => {
  describe('zSystemCategory', () => {
    it('accepts all 12 valid categories', () => {
      const categories: SystemCategory[] = [
        'movement', 'input', 'camera', 'world', 'challenge',
        'entities', 'progression', 'feedback', 'narrative',
        'audio', 'visual', 'physics',
      ];
      for (const cat of categories) {
        expect(zSystemCategory.parse(cat)).toBe(cat);
      }
    });

    it('rejects invalid category strings', () => {
      expect(() => zSystemCategory.parse('platformer')).toThrow();
      expect(() => zSystemCategory.parse('shooting')).toThrow();
      expect(() => zSystemCategory.parse('')).toThrow();
    });
  });

  describe('FALLBACK_SCHEMA', () => {
    it('accepts valid primitive fallbacks', () => {
      expect(FALLBACK_SCHEMA.parse('primitive:cube')).toBe('primitive:cube');
      expect(FALLBACK_SCHEMA.parse('primitive:sphere')).toBe('primitive:sphere');
      expect(FALLBACK_SCHEMA.parse('builtin:default-texture')).toBe('builtin:default-texture');
    });

    it('rejects invalid fallback formats', () => {
      expect(() => FALLBACK_SCHEMA.parse('cube')).toThrow();
      expect(() => FALLBACK_SCHEMA.parse('custom:MyModel')).toThrow(); // uppercase
      expect(() => FALLBACK_SCHEMA.parse('')).toThrow();
      expect(() => FALLBACK_SCHEMA.parse('primitive:')).toThrow();
      expect(() => FALLBACK_SCHEMA.parse('unknown:cube')).toThrow();
    });

    it('rejects names longer than 64 characters total', () => {
      // Regex allows [a-z] + [a-z0-9_-]{0,63} = max 64 chars after prefix
      const longName = 'a'.repeat(65);
      expect(() => FALLBACK_SCHEMA.parse(`primitive:${longName}`)).toThrow();
    });

    it('accepts names at max length (1 + 63 = 64 chars)', () => {
      const maxName = 'a'.repeat(64); // 1 char [a-z] + 63 chars [a-z0-9_-]
      expect(FALLBACK_SCHEMA.parse(`primitive:${maxName}`)).toBe(`primitive:${maxName}`);
    });
  });

  describe('type compatibility (compile-time)', () => {
    // These tests verify that types compile correctly. If the types
    // are wrong, these will produce TypeScript errors at build time.

    it('ExecutorName is a valid union', () => {
      const names: ExecutorName[] = [
        'scene_create', 'physics_profile', 'character_setup',
        'entity_setup', 'asset_generate', 'custom_script_generate',
        'verify_all_scenes', 'auto_polish',
      ];
      expect(names).toHaveLength(8);
    });

    it('GameSystem has required fields', () => {
      const system: GameSystem = {
        category: 'movement',
        type: 'walk+jump',
        config: { jumpHeight: 5 },
        priority: 'core',
        dependsOn: ['input'],
      };
      expect(system.category).toBe('movement');
      expect(system.dependsOn).toContain('input');
    });

    it('FeelDirective captures experiential intent', () => {
      const feel: FeelDirective = {
        mood: 'cozy',
        pacing: 'slow',
        weight: 'light',
        referenceGames: ['Stardew Valley'],
        oneLiner: 'A cozy farming sim',
      };
      expect(feel.pacing).toBe('slow');
    });

    it('SceneBlueprint with entities and transitions', () => {
      const entity: EntityBlueprint = {
        name: 'Player',
        role: 'player',
        systems: ['movement', 'input'],
        appearance: 'pixel art character',
        behaviors: ['walk', 'jump'],
      };
      const scene: SceneBlueprint = {
        name: 'Level 1',
        purpose: 'Introduction',
        systems: ['movement', 'camera'],
        entities: [entity],
        transitions: [{ to: 'Level 2', trigger: 'reach_exit' }],
      };
      expect(scene.entities).toHaveLength(1);
      expect(scene.transitions[0].to).toBe('Level 2');
    });

    it('AssetNeed with fallback', () => {
      const asset: AssetNeed = {
        type: 'texture',
        description: 'grass texture',
        styleDirective: 'pixel art',
        priority: 'required',
        fallback: 'builtin:default-texture',
      };
      expect(FALLBACK_SCHEMA.parse(asset.fallback)).toBe(asset.fallback);
    });

    it('PlanStep with all status values', () => {
      const statuses: PlanStep['status'][] = [
        'pending', 'running', 'completed', 'failed', 'skipped',
      ];
      expect(statuses).toHaveLength(5);
    });

    it('OrchestratorPlan with all status values', () => {
      const statuses: OrchestratorPlan['status'][] = [
        'planning', 'awaiting_approval', 'executing',
        'completed', 'failed', 'cancelled',
      ];
      expect(statuses).toHaveLength(6);
    });

    it('TokenEstimate with breakdown', () => {
      const estimate: TokenEstimate = {
        breakdown: [
          { category: 'AI generation', estimatedTokens: 500, variance: 0.3 },
        ],
        totalEstimated: 500,
        totalVarianceHigh: 650,
        totalVarianceLow: 350,
        userTier: 'Creator',
        sufficientBalance: true,
      };
      expect(estimate.sufficientBalance).toBe(true);
    });

    it('ExecutorResult shape', () => {
      const success: ExecutorResult = { success: true, output: { entityId: '1' } };
      const failure: ExecutorResult = {
        success: false,
        error: {
          code: 'SCENE_CREATE_FAILED',
          message: 'internal',
          userFacingMessage: 'Could not create scene',
          retryable: true,
        },
      };
      expect(success.success).toBe(true);
      expect(failure.error?.retryable).toBe(true);
    });
  });
});
