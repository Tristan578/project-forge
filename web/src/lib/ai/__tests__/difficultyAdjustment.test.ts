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
import { ENGINE_COMPONENT_TYPES } from '@/lib/engine/gameComponentWire';
import type { GameComponentData } from '@/stores/slices/types';

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

/**
 * Full-shape assertions throughout. The previous suite only checked that a
 * `properties` bag contained a `healthMultiplier` key — a field name that exists on
 * none of the 13 engine component types — and never looked at `componentType`, which
 * was absent entirely. Both defects passed (PF-1118).
 */
describe('difficultyToCommands', () => {
  const health = (maxHp: number, currentHp = maxHp): GameComponentData => ({
    type: 'health',
    health: {
      maxHp,
      currentHp,
      invincibilitySecs: 0.5,
      respawnOnDeath: true,
      respawnPoint: [0, 1, 0],
    },
  });

  const follower = (speed: number): GameComponentData => ({
    type: 'follower',
    follower: { targetEntityId: null, speed, stopDistance: 1.5, lookAtTarget: true },
  });

  const damageZone = (damagePerSecond: number): GameComponentData => ({
    type: 'damageZone',
    damageZone: { damagePerSecond, oneShot: false },
  });

  const projectile = (speed: number, damage: number): GameComponentData => ({
    type: 'projectile',
    projectile: { speed, damage, lifetimeSecs: 5, gravity: false, destroyOnHit: true },
  });

  it('scales health onto the engine maxHp/currentHp fields, as a complete component', () => {
    const profile = makeProfile({ enemyHealthMultiplier: 1.5 });
    const cmds = difficultyToCommands(profile, [
      { entityId: 'e1', baseComponents: [health(100)] },
    ]);

    expect(cmds).toEqual([
      {
        cmd: 'update_game_component',
        entityId: 'e1',
        componentType: 'health',
        properties: {
          maxHp: 150,
          currentHp: 150,
          invincibilitySecs: 0.5,
          respawnOnDeath: true,
          respawnPoint: [0, 1, 0],
        },
      },
    ]);
  });

  it('scales currentHp proportionally rather than refilling a damaged enemy', () => {
    const cmds = difficultyToCommands(makeProfile({ enemyHealthMultiplier: 2 }), [
      { entityId: 'e1', baseComponents: [health(100, 40)] },
    ]);
    const props = cmds[0].properties as Record<string, number>;
    expect(props.maxHp).toBe(200);
    expect(props.currentHp).toBe(80);
  });

  it('scales follower speed by the enemy speed multiplier', () => {
    const cmds = difficultyToCommands(makeProfile({ enemySpeedMultiplier: 1.4 }), [
      { entityId: 'e1', baseComponents: [follower(3)] },
    ]);

    expect(cmds).toEqual([
      {
        cmd: 'update_game_component',
        entityId: 'e1',
        componentType: 'follower',
        properties: {
          targetEntityId: null,
          speed: 4.2,
          stopDistance: 1.5,
          lookAtTarget: true,
        },
      },
    ]);
  });

  it('scales damage-zone damage per second by the enemy damage multiplier', () => {
    const cmds = difficultyToCommands(makeProfile({ enemyDamageMultiplier: 0.5 }), [
      { entityId: 'e1', baseComponents: [damageZone(25)] },
    ]);

    expect(cmds).toEqual([
      {
        cmd: 'update_game_component',
        entityId: 'e1',
        componentType: 'damage_zone',
        properties: { damagePerSecond: 12.5, oneShot: false },
      },
    ]);
  });

  it('scales projectile damage and speed by their respective multipliers', () => {
    const cmds = difficultyToCommands(
      makeProfile({ enemyDamageMultiplier: 2, enemySpeedMultiplier: 1.5 }),
      [{ entityId: 'e1', baseComponents: [projectile(15, 10)] }],
    );

    expect(cmds).toEqual([
      {
        cmd: 'update_game_component',
        entityId: 'e1',
        componentType: 'projectile',
        properties: {
          speed: 22.5,
          damage: 20,
          lifetimeSecs: 5,
          gravity: false,
          destroyOnHit: true,
        },
      },
    ]);
  });

  it('emits one command per scalable component on the same entity', () => {
    const cmds = difficultyToCommands(makeProfile(), [
      { entityId: 'e1', baseComponents: [health(100), follower(3)] },
    ]);
    expect(cmds.map((c) => c.componentType)).toEqual(['health', 'follower']);
  });

  it('never emits a command that the engine would reject for a missing componentType', () => {
    const cmds = difficultyToCommands(makeProfile(), [
      { entityId: 'e1', baseComponents: [health(100), follower(3), damageZone(25)] },
    ]);
    expect(cmds.length).toBeGreaterThan(0);
    for (const cmd of cmds) {
      expect(typeof cmd.componentType).toBe('string');
      expect(ENGINE_COMPONENT_TYPES).toContain(cmd.componentType as string);
      expect(cmd.properties).toBeTypeOf('object');
    }
  });

  it('ignores components difficulty does not own', () => {
    const cmds = difficultyToCommands(makeProfile({ enemySpeedMultiplier: 2 }), [
      {
        entityId: 'e1',
        baseComponents: [
          {
            type: 'characterController',
            characterController: {
              speed: 5,
              jumpHeight: 8,
              gravityScale: 1,
              canDoubleJump: false,
            },
          },
          { type: 'checkpoint', checkpoint: { autoSave: true } },
        ],
      },
    ]);
    expect(cmds).toEqual([]);
  });

  it('returns empty array for no entities', () => {
    expect(difficultyToCommands(makeProfile(), [])).toEqual([]);
  });

  /**
   * The previous version of this test asserted
   * `difficultyToCommands(p, t) toEqual difficultyToCommands(p, t)` and was named
   * "is idempotent — re-running does not compound". Both sides are the same pure
   * call on the same inputs, so the only way it could ever fail is if the function
   * mutated its own argument — it could not fail for the reason its name claimed.
   * The two tests below split that into the two claims that CAN fail: the call
   * leaves `baseComponents` untouched, and re-feeding a previous result DOES
   * compound (which is exactly what `DifficultyTarget`'s doc-comment warns about).
   */
  it('does not mutate the supplied baseComponents', () => {
    const target = [{ entityId: 'e1', baseComponents: [health(100)] }];
    const untouched = structuredClone(target);
    const profile = makeProfile({ enemyHealthMultiplier: 1.5 });

    difficultyToCommands(profile, target);

    expect(target).toEqual(untouched);
  });

  it('compounds when a previous run’s scaled output is fed back in as the baseline', () => {
    const profile = makeProfile({ enemyHealthMultiplier: 1.5 });

    const first = difficultyToCommands(profile, [
      { entityId: 'e1', baseComponents: [health(100)] },
    ]);
    const firstHp = (first[0].properties as { maxHp: number }).maxHp;
    expect(firstHp).toBe(150);

    // The misuse `DifficultyTarget` documents: passing the entity's already-scaled
    // LIVE values back in as the baseline. The multipliers are absolute, so 1.5x on
    // a 1.5x enemy is 2.25x and difficulty runs away over a session. Asserted, not
    // merely warned about in prose — callers must re-derive from authored values.
    const second = difficultyToCommands(profile, [
      { entityId: 'e1', baseComponents: [health(firstHp)] },
    ]);

    expect((second[0].properties as { maxHp: number }).maxHp).toBe(225);
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
