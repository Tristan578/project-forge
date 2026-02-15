import { describe, it, expect } from 'vitest';
import { getTokenCost, TOKEN_COSTS, TIER_MONTHLY_TOKENS, TOKEN_PACKAGES } from './pricing';

describe('getTokenCost', () => {
  it('returns correct cost for 3d_generation standard quality', () => {
    expect(getTokenCost('3d_generation')).toBe(100);
    expect(getTokenCost('3d_generation', 'standard')).toBe(100);
  });

  it('returns correct cost for 3d_generation high quality', () => {
    expect(getTokenCost('3d_generation', 'high')).toBe(200);
  });

  it('returns correct cost for chat_message short', () => {
    expect(getTokenCost('chat_message')).toBe(5);
    expect(getTokenCost('chat_message', 'short')).toBe(5);
  });

  it('returns correct cost for chat_message long', () => {
    expect(getTokenCost('chat_message', 'long')).toBe(15);
  });

  it('returns correct cost for direct operation keys', () => {
    expect(getTokenCost('texture_generation')).toBe(30);
    expect(getTokenCost('image_to_3d')).toBe(150);
    expect(getTokenCost('voice_generation')).toBe(40);
    expect(getTokenCost('music_generation')).toBe(80);
    expect(getTokenCost('sfx_generation')).toBe(20);
  });

  it('returns 0 for unknown operations (free)', () => {
    expect(getTokenCost('scene_edit')).toBe(0);
    expect(getTokenCost('unknown_op')).toBe(0);
  });
});

describe('TOKEN_COSTS', () => {
  it('has all expected operations', () => {
    const ops = Object.keys(TOKEN_COSTS);
    expect(ops).toContain('chat_short');
    expect(ops).toContain('chat_long');
    expect(ops).toContain('3d_generation_standard');
    expect(ops).toContain('3d_generation_high');
    expect(ops).toContain('texture_generation');
    expect(ops).toContain('image_to_3d');
    expect(ops).toContain('voice_generation');
    expect(ops).toContain('music_generation');
    expect(ops).toContain('sfx_generation');
  });

  it('all costs are positive integers', () => {
    for (const [, cost] of Object.entries(TOKEN_COSTS)) {
      expect(cost).toBeGreaterThan(0);
      expect(Number.isInteger(cost)).toBe(true);
    }
  });
});

describe('TIER_MONTHLY_TOKENS', () => {
  it('all tiers get monthly tokens', () => {
    expect(TIER_MONTHLY_TOKENS.starter).toBe(50);
    expect(TIER_MONTHLY_TOKENS.hobbyist).toBe(300);
    expect(TIER_MONTHLY_TOKENS.creator).toBe(1000);
    expect(TIER_MONTHLY_TOKENS.pro).toBe(3000);
  });
});

describe('TOKEN_PACKAGES', () => {
  it('has correct structure', () => {
    for (const [, pkg] of Object.entries(TOKEN_PACKAGES)) {
      expect(pkg.tokens).toBeGreaterThan(0);
      expect(pkg.priceCents).toBeGreaterThan(0);
      expect(pkg.label).toBeTruthy();
    }
  });

  it('bulk discounts increase with package size', () => {
    const spark = TOKEN_PACKAGES.spark;
    const blaze = TOKEN_PACKAGES.blaze;
    const inferno = TOKEN_PACKAGES.inferno;

    const sparkRate = spark.priceCents / spark.tokens;
    const blazeRate = blaze.priceCents / blaze.tokens;
    const infernoRate = inferno.priceCents / inferno.tokens;

    expect(blazeRate).toBeLessThan(sparkRate);
    expect(infernoRate).toBeLessThan(blazeRate);
  });
});
