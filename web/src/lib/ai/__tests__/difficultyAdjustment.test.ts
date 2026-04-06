import { describe, it, expect } from 'vitest';
import {
  calculateDifficultyAdjustment,
  performanceToSkillRating,
  difficultyToCommands,
  generateDDAScript,
  createDefaultProfile,
  DDA_PRESETS,
  type DDAConfig,
  type PlayerPerformance,
  type DifficultyProfile,
} from '../difficultyAdjustment';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePerformance(overrides: Partial<PlayerPerformance> = {}): PlayerPerformance {
  return {
    deathsPerMinute: 0.5,
    averageHealthOnDeath: 30,
    timePerLevel: 180,
    itemUsageRate: 0.4,
    skillRating: 50,
    ...overrides,
  };
}

function makeProfile(overrides: Partial<DifficultyProfile> = {}): DifficultyProfile {
  return { ...createDefaultProfile(), ...overrides };
}

function makeConfig(overrides: Partial<DDAConfig> = {}): DDAConfig {
  return { ...DDA_PRESETS.standard, isCompetitive: false, ...overrides };
}

// ---------------------------------------------------------------------------
// performanceToSkillRating
// ---------------------------------------------------------------------------

describe('performanceToSkillRating', () => {
  it('returns 0-100 range', () => {
    const low = performanceToSkillRating(makePerformance({ deathsPerMinute: 10, timePerLevel: 600 }));
    const high = performanceToSkillRating(makePerformance({ deathsPerMinute: 0, timePerLevel: 60 }));
    expect(low).toBeGreaterThanOrEqual(0);
    expect(low).toBeLessThanOrEqual(100);
    expect(high).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(100);
  });

  it('low deaths and fast time yield high skill', () => {
    const rating = performanceToSkillRating(
      makePerformance({ deathsPerMinute: 0, timePerLevel: 60, itemUsageRate: 0 }),
    );
    expect(rating).toBeGreaterThan(70);
  });

  it('high deaths yield low skill', () => {
    const rating = performanceToSkillRating(
      makePerformance({ deathsPerMinute: 5, timePerLevel: 600, itemUsageRate: 1.0 }),
    );
    expect(rating).toBeLessThan(30);
  });

  it('returns an integer', () => {
    const rating = performanceToSkillRating(makePerformance());
    expect(Number.isInteger(rating)).toBe(true);
  });

  it('returns very low rating for extreme struggle', () => {
    const rating = performanceToSkillRating(
      makePerformance({ deathsPerMinute: 100, timePerLevel: 10000, itemUsageRate: 5 }),
    );
    expect(rating).toBeLessThanOrEqual(15);
  });
});

// ---------------------------------------------------------------------------
// calculateDifficultyAdjustment
// ---------------------------------------------------------------------------

describe('calculateDifficultyAdjustment', () => {
  it('returns unchanged profile when disabled', () => {
    const profile = makeProfile({ level: 0.7 });
    const result = calculateDifficultyAdjustment(
      makePerformance(),
      profile,
      makeConfig({ enabled: false }),
    );
    expect(result.level).toBe(0.7);
  });

  it('decreases difficulty on high death rate', () => {
    const profile = makeProfile({ level: 0.7 });
    const result = calculateDifficultyAdjustment(
      makePerformance({ deathsPerMinute: 4, timePerLevel: 600 }),
      profile,
      makeConfig(),
    );
    expect(result.level).toBeLessThan(0.7);
  });

  it('increases difficulty on fast level completion with no deaths', () => {
    const profile = makeProfile({ level: 0.4 });
    const result = calculateDifficultyAdjustment(
      makePerformance({ deathsPerMinute: 0, timePerLevel: 30, itemUsageRate: 0 }),
      profile,
      makeConfig(),
    );
    expect(result.level).toBeGreaterThan(0.4);
  });

  it('clamps to minDifficulty', () => {
    const profile = makeProfile({ level: 0.35 });
    const result = calculateDifficultyAdjustment(
      makePerformance({ deathsPerMinute: 10 }),
      profile,
      makeConfig({ minDifficulty: 0.3 }),
    );
    expect(result.level).toBeGreaterThanOrEqual(0.3);
  });

  it('clamps to maxDifficulty', () => {
    const profile = makeProfile({ level: 0.95 });
    const result = calculateDifficultyAdjustment(
      makePerformance({ deathsPerMinute: 0, timePerLevel: 10 }),
      profile,
      makeConfig({ maxDifficulty: 1.0 }),
    );
    expect(result.level).toBeLessThanOrEqual(1.0);
  });

  it('competitive preset never decreases difficulty', () => {
    const config = DDA_PRESETS.competitive;
    const profile = makeProfile({ level: 0.8 });
    const result = calculateDifficultyAdjustment(
      makePerformance({ deathsPerMinute: 5, timePerLevel: 600 }),
      profile,
      config,
    );
    expect(result.level).toBeGreaterThanOrEqual(0.8);
  });

  it('isCompetitive=true prevents difficulty decrease', () => {
    const profile = makeProfile({ level: 0.7 });
    const result = calculateDifficultyAdjustment(
      makePerformance({ deathsPerMinute: 5, timePerLevel: 600 }),
      profile,
      makeConfig({ isCompetitive: true }),
    );
    expect(result.level).toBeGreaterThanOrEqual(0.7);
  });

  it('isCompetitive=false allows difficulty to decrease', () => {
    const profile = makeProfile({ level: 0.7 });
    const result = calculateDifficultyAdjustment(
      makePerformance({ deathsPerMinute: 5, timePerLevel: 600 }),
      profile,
      makeConfig({ isCompetitive: false }),
    );
    expect(result.level).toBeLessThan(0.7);
  });

  it('neverDecrease=true still works for backwards compatibility', () => {
    const profile = makeProfile({ level: 0.7 });
    const result = calculateDifficultyAdjustment(
      makePerformance({ deathsPerMinute: 5, timePerLevel: 600 }),
      profile,
      makeConfig({ isCompetitive: false, neverDecrease: true }),
    );
    expect(result.level).toBeGreaterThanOrEqual(0.7);
  });

  it('adjusts enemy multipliers proportionally to level', () => {
    const profile = makeProfile({ level: 0.5 });
    const result = calculateDifficultyAdjustment(
      makePerformance({ deathsPerMinute: 0, timePerLevel: 30 }),
      profile,
      makeConfig(),
    );
    // Higher level => higher enemy multipliers
    if (result.level > profile.level) {
      expect(result.enemyHealthMultiplier).toBeGreaterThan(1.0);
    }
  });

  it('adjusts resource drop rate inversely to level', () => {
    const result = calculateDifficultyAdjustment(
      makePerformance({ deathsPerMinute: 0, timePerLevel: 30 }),
      makeProfile({ level: 0.3 }),
      makeConfig(),
    );
    // Higher difficulty => lower resource drops
    expect(result.resourceDropRate).toBeLessThan(1.5);
  });

  it('produces consistent output for identical inputs', () => {
    const perf = makePerformance();
    const profile = makeProfile();
    const config = makeConfig();
    const a = calculateDifficultyAdjustment(perf, profile, config);
    const b = calculateDifficultyAdjustment(perf, profile, config);
    expect(a).toEqual(b);
  });

  it('gentle preset adjusts slowly', () => {
    const profile = makeProfile({ level: 0.5 });
    const perf = makePerformance({ deathsPerMinute: 3 });
    const gentle = calculateDifficultyAdjustment(perf, profile, DDA_PRESETS.gentle);
    const standard = calculateDifficultyAdjustment(perf, profile, DDA_PRESETS.standard);
    // Gentle should move less than standard
    const gentleDelta = Math.abs(gentle.level - 0.5);
    const standardDelta = Math.abs(standard.level - 0.5);
    expect(gentleDelta).toBeLessThan(standardDelta);
  });

  it('hardcore preset adjusts faster than standard', () => {
    const profile = makeProfile({ level: 0.7 });
    const perf = makePerformance({ deathsPerMinute: 3 });
    const hardcore = calculateDifficultyAdjustment(perf, profile, DDA_PRESETS.hardcore);
    const standard = calculateDifficultyAdjustment(perf, profile, DDA_PRESETS.standard);
    const hardDelta = Math.abs(hardcore.level - 0.7);
    const stdDelta = Math.abs(standard.level - 0.7);
    expect(hardDelta).toBeGreaterThan(stdDelta);
  });
});

// ---------------------------------------------------------------------------
// DDA_PRESETS
// ---------------------------------------------------------------------------

describe('DDA_PRESETS', () => {
  it('has 5 presets', () => {
    expect(Object.keys(DDA_PRESETS)).toHaveLength(5);
  });

  it.each(Object.entries(DDA_PRESETS))('preset "%s" has valid config', (_name, config) => {
    expect(config.enabled).toBe(true);
    expect(config.sensitivity).toBeGreaterThan(0);
    expect(config.sensitivity).toBeLessThanOrEqual(1);
    expect(config.minDifficulty).toBeLessThan(config.maxDifficulty);
    expect(config.adjustmentSpeed).toBeGreaterThan(0);
    expect(config.cooldownSeconds).toBeGreaterThan(0);
    expect(typeof config.isCompetitive).toBe('boolean');
  });

  it('only the competitive preset has isCompetitive=true', () => {
    const competitivePresets = Object.entries(DDA_PRESETS)
      .filter(([, cfg]) => cfg.isCompetitive)
      .map(([name]) => name);
    expect(competitivePresets).toEqual(['competitive']);
  });

  it('gentle has wider range than hardcore', () => {
    const gentleRange = DDA_PRESETS.gentle.maxDifficulty - DDA_PRESETS.gentle.minDifficulty;
    const hardcoreRange = DDA_PRESETS.hardcore.maxDifficulty - DDA_PRESETS.hardcore.minDifficulty;
    expect(gentleRange).toBeGreaterThan(hardcoreRange);
  });
});

// ---------------------------------------------------------------------------
// createDefaultProfile
// ---------------------------------------------------------------------------

describe('createDefaultProfile', () => {
  it('returns level 0.5', () => {
    expect(createDefaultProfile().level).toBe(0.5);
  });

  it('returns neutral multipliers', () => {
    const p = createDefaultProfile();
    expect(p.enemyHealthMultiplier).toBe(1.0);
    expect(p.enemyDamageMultiplier).toBe(1.0);
    expect(p.enemySpeedMultiplier).toBe(1.0);
    expect(p.resourceDropRate).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// difficultyToCommands
// ---------------------------------------------------------------------------

describe('difficultyToCommands', () => {
  it('returns one command per entity', () => {
    const profile = makeProfile();
    const cmds = difficultyToCommands(profile, ['e1', 'e2', 'e3']);
    expect(cmds).toHaveLength(3);
  });

  it('each command targets the correct entity', () => {
    const cmds = difficultyToCommands(makeProfile(), ['abc']);
    expect(cmds[0].cmd).toBe('update_game_component');
    expect(cmds[0].entityId).toBe('abc');
  });

  it('embeds multiplier properties', () => {
    const profile = makeProfile({ enemyHealthMultiplier: 1.5 });
    const cmds = difficultyToCommands(profile, ['e1']);
    const props = cmds[0].properties as Record<string, number>;
    expect(props.healthMultiplier).toBe(1.5);
  });

  it('returns empty array for no entities', () => {
    expect(difficultyToCommands(makeProfile(), [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// generateDDAScript
// ---------------------------------------------------------------------------

describe('generateDDAScript', () => {
  it('returns a non-empty string', () => {
    const script = generateDDAScript(DDA_PRESETS.standard);
    expect(script.length).toBeGreaterThan(0);
  });

  it('embeds the config JSON', () => {
    const script = generateDDAScript(DDA_PRESETS.gentle);
    expect(script).toContain('"sensitivity": 0.3');
  });

  it('contains onStart and onUpdate', () => {
    const script = generateDDAScript(DDA_PRESETS.standard);
    expect(script).toContain('function onStart');
    expect(script).toContain('function onUpdate');
  });

  it('references forge APIs', () => {
    const script = generateDDAScript(DDA_PRESETS.standard);
    expect(script).toContain('forge.time.elapsed');
    expect(script).toContain('forge.ui.updateText');
    expect(script).toContain('forge.ui.showText');
  });

  it('includes cooldown check', () => {
    const script = generateDDAScript(DDA_PRESETS.standard);
    expect(script).toContain('cooldownSeconds');
  });
});
