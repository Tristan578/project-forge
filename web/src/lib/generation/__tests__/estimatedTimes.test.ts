/**
 * Unit tests for generation time estimation utilities.
 */
import { describe, it, expect } from 'vitest';
import {
  ESTIMATED_TIMES,
  getEstimatedSeconds,
  formatEstimatedTime,
  getCurrentStage,
  GENERATION_STAGES,
} from '../estimatedTimes';
import type { GenerationType } from '@/stores/generationStore';

// ─── ESTIMATED_TIMES ──────────────────────────────────────────────────────────

describe('ESTIMATED_TIMES', () => {
  it('covers all GenerationType values', () => {
    const expected: GenerationType[] = [
      'model', 'texture', 'sfx', 'voice', 'music',
      'skybox', 'sprite', 'sprite_sheet', 'tileset', 'pixel-art',
    ];
    for (const type of expected) {
      expect(ESTIMATED_TIMES[type], `missing entry for "${type}"`).toBeDefined();
    }
  });

  it('has valid min < max for every entry', () => {
    for (const [type, range] of Object.entries(ESTIMATED_TIMES)) {
      expect(range.min, `${type}.min`).toBeGreaterThan(0);
      expect(range.max, `${type}.max`).toBeGreaterThan(range.min);
    }
  });

  it('has a non-empty label for every entry', () => {
    for (const [type, range] of Object.entries(ESTIMATED_TIMES)) {
      expect(range.label, `${type}.label`).not.toBe('');
    }
  });

  it('has model range 60-120s', () => {
    expect(ESTIMATED_TIMES.model.min).toBe(60);
    expect(ESTIMATED_TIMES.model.max).toBe(120);
  });

  it('has texture range 20-45s', () => {
    expect(ESTIMATED_TIMES.texture.min).toBe(20);
    expect(ESTIMATED_TIMES.texture.max).toBe(45);
  });

  it('has music range 30-90s', () => {
    expect(ESTIMATED_TIMES.music.min).toBe(30);
    expect(ESTIMATED_TIMES.music.max).toBe(90);
  });
});

// ─── getEstimatedSeconds ──────────────────────────────────────────────────────

describe('getEstimatedSeconds', () => {
  it('returns midpoint for known type', () => {
    // model: (60 + 120) / 2 = 90
    expect(getEstimatedSeconds('model')).toBe(90);
  });

  it('returns midpoint for texture', () => {
    // texture: (20 + 45) / 2 = 32.5 → rounds to 33
    expect(getEstimatedSeconds('texture')).toBe(33);
  });

  it('returns midpoint for sfx', () => {
    // sfx: (5 + 15) / 2 = 10
    expect(getEstimatedSeconds('sfx')).toBe(10);
  });

  it('returns positive number for every known type', () => {
    const types: GenerationType[] = [
      'model', 'texture', 'sfx', 'voice', 'music',
      'skybox', 'sprite', 'sprite_sheet', 'tileset', 'pixel-art',
    ];
    for (const type of types) {
      expect(getEstimatedSeconds(type)).toBeGreaterThan(0);
    }
  });
});

// ─── formatEstimatedTime ──────────────────────────────────────────────────────

describe('formatEstimatedTime', () => {
  it('returns "Almost done..." at 90% progress', () => {
    expect(formatEstimatedTime('model', 90)).toBe('Almost done...');
  });

  it('returns "Almost done..." at 100% progress', () => {
    expect(formatEstimatedTime('texture', 100)).toBe('Almost done...');
  });

  it('returns "Almost done..." at 95% progress', () => {
    expect(formatEstimatedTime('music', 95)).toBe('Almost done...');
  });

  it('returns range string when no progress given', () => {
    // model: 60-120s → "~1-2 min" (both divisible by 60)
    const result = formatEstimatedTime('model');
    expect(result).toBe('~1-2 min');
  });

  it('returns sub-60s range for fast operations', () => {
    // sfx: 5-15s
    const result = formatEstimatedTime('sfx');
    expect(result).toMatch(/~5-15s/);
  });

  it('formats mixed seconds/minutes range without overstating max (regression for PF-148)', () => {
    // music: 30-90s — max is 1m 30s, NOT 2 min. Must not show "~30s-2 min".
    const result = formatEstimatedTime('music');
    expect(result).toBe('~30s-1m 30s');
    expect(result).not.toContain('2 min');
  });

  it('formats all-minutes range with exact minutes when divisible', () => {
    // skybox: 30-60s → min=0m30s, max=1m0s → "~30s-1 min"
    const result = formatEstimatedTime('skybox');
    expect(result).toBe('~30s-1 min');
  });

  it('returns "Almost done..." when computed remaining < 10s', () => {
    // progress=50, elapsed=45s → ~45s per 50% = 90s total, 50% left = ~45s
    // progress=98, elapsed=100 → 100/98 * 2 ≈ 2s remaining → "Almost done..."
    const result = formatEstimatedTime('model', 98, 100);
    expect(result).toBe('Almost done...');
  });

  it('returns seconds remaining when < 60s', () => {
    // progress=50, elapsed=20 → 20/50 = 0.4 s/% * 50% remaining = 20s → "~20s remaining"
    const result = formatEstimatedTime('texture', 50, 20);
    expect(result).toMatch(/~\d+s remaining/);
  });

  it('returns minutes remaining when >= 60s', () => {
    // progress=10, elapsed=60 → 6s/% * 90 remaining = 540s → "~9 min remaining"
    const result = formatEstimatedTime('model', 10, 60);
    expect(result).toMatch(/~\d+ min remaining/);
  });

  it('returns empty string for unknown type', () => {
    // TypeScript won't catch this but guard exists at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = formatEstimatedTime('unknown' as any);
    expect(result).toBe('');
  });
});

// ─── getCurrentStage ──────────────────────────────────────────────────────────

describe('getCurrentStage', () => {
  it('returns first stage at 0% progress', () => {
    const stage = getCurrentStage('model', 0);
    expect(stage).toBe(GENERATION_STAGES.model[0]);
  });

  it('returns last stage near 100% progress', () => {
    const stages = GENERATION_STAGES.model;
    const stage = getCurrentStage('model', 99);
    expect(stage).toBe(stages[stages.length - 1]);
  });

  it('returns a middle stage at 50% progress', () => {
    const stage = getCurrentStage('model', 50);
    expect(stage).not.toBe('');
  });

  it('never returns empty string for known types', () => {
    const types: GenerationType[] = [
      'model', 'texture', 'sfx', 'voice', 'music',
      'skybox', 'sprite', 'sprite_sheet', 'tileset', 'pixel-art',
    ];
    for (const type of types) {
      for (const progress of [0, 25, 50, 75, 99, 100]) {
        const stage = getCurrentStage(type, progress);
        expect(stage, `${type} @ ${progress}%`).not.toBe('');
      }
    }
  });

  it('clamps stage index so progress > 100 does not throw', () => {
    expect(() => getCurrentStage('model', 150)).not.toThrow();
    const stage = getCurrentStage('model', 150);
    const stages = GENERATION_STAGES.model;
    expect(stage).toBe(stages[stages.length - 1]);
  });

  it('returns fallback for type with empty stages array', () => {
    // Temporarily simulate an unknown type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = getCurrentStage('unknown' as any, 50);
    expect(result).toBe('Processing...');
  });
});

// ─── GENERATION_STAGES ───────────────────────────────────────────────────────

describe('GENERATION_STAGES', () => {
  it('covers all GenerationType values', () => {
    const expected: GenerationType[] = [
      'model', 'texture', 'sfx', 'voice', 'music',
      'skybox', 'sprite', 'sprite_sheet', 'tileset', 'pixel-art',
    ];
    for (const type of expected) {
      expect(GENERATION_STAGES[type], `missing stages for "${type}"`).toBeDefined();
      expect(GENERATION_STAGES[type].length, `empty stages for "${type}"`).toBeGreaterThan(0);
    }
  });

  it('has at least 2 stages for model (multi-step process)', () => {
    expect(GENERATION_STAGES.model.length).toBeGreaterThanOrEqual(2);
  });

  it('each stage label is a non-empty string ending with "..."', () => {
    for (const [type, stages] of Object.entries(GENERATION_STAGES)) {
      for (const stage of stages) {
        expect(stage, `${type} stage "${stage}"`).not.toBe('');
        expect(stage.endsWith('...'), `${type}: "${stage}" should end with "..."`).toBe(true);
      }
    }
  });
});
