import { describe, it, expect } from 'vitest';
import {
  TOKEN_COSTS,
  TIER_MONTHLY_TOKENS,
  TOKEN_PACKAGES,
  getTokenCost,
} from '../pricing';

describe('TOKEN_COSTS', () => {
  it('should have positive costs for all operations', () => {
    for (const [key, cost] of Object.entries(TOKEN_COSTS)) {
      expect(cost, `${key} should be positive`).toBeGreaterThan(0);
    }
  });

  it('should have expected operations defined', () => {
    expect(TOKEN_COSTS.chat_short).toBeDefined();
    expect(TOKEN_COSTS.chat_long).toBeDefined();
    expect(TOKEN_COSTS['3d_generation_standard']).toBeDefined();
    expect(TOKEN_COSTS['3d_generation_high']).toBeDefined();
    expect(TOKEN_COSTS.texture_generation).toBeDefined();
    expect(TOKEN_COSTS.voice_generation).toBeDefined();
    expect(TOKEN_COSTS.music_generation).toBeDefined();
    expect(TOKEN_COSTS.sfx_generation).toBeDefined();
    expect(TOKEN_COSTS.skybox_generation).toBeDefined();
  });

  it('should have high quality cost more than standard for 3D', () => {
    expect(TOKEN_COSTS['3d_generation_high']).toBeGreaterThan(TOKEN_COSTS['3d_generation_standard']);
  });
});

describe('TIER_MONTHLY_TOKENS', () => {
  it('should have ascending token allocations', () => {
    expect(TIER_MONTHLY_TOKENS.starter).toBeLessThan(TIER_MONTHLY_TOKENS.hobbyist);
    expect(TIER_MONTHLY_TOKENS.hobbyist).toBeLessThan(TIER_MONTHLY_TOKENS.creator);
    expect(TIER_MONTHLY_TOKENS.creator).toBeLessThan(TIER_MONTHLY_TOKENS.pro);
  });

  it('should have all tiers defined', () => {
    expect(TIER_MONTHLY_TOKENS.starter).toBeDefined();
    expect(TIER_MONTHLY_TOKENS.hobbyist).toBeDefined();
    expect(TIER_MONTHLY_TOKENS.creator).toBeDefined();
    expect(TIER_MONTHLY_TOKENS.pro).toBeDefined();
  });
});

describe('TOKEN_PACKAGES', () => {
  it('should have ascending token amounts', () => {
    expect(TOKEN_PACKAGES.spark.tokens).toBeLessThan(TOKEN_PACKAGES.blaze.tokens);
    expect(TOKEN_PACKAGES.blaze.tokens).toBeLessThan(TOKEN_PACKAGES.inferno.tokens);
  });

  it('should have better value per token for larger packages', () => {
    const sparkRate = TOKEN_PACKAGES.spark.priceCents / TOKEN_PACKAGES.spark.tokens;
    const blazeRate = TOKEN_PACKAGES.blaze.priceCents / TOKEN_PACKAGES.blaze.tokens;
    const infernoRate = TOKEN_PACKAGES.inferno.priceCents / TOKEN_PACKAGES.inferno.tokens;
    expect(blazeRate).toBeLessThan(sparkRate);
    expect(infernoRate).toBeLessThan(blazeRate);
  });
});

describe('getTokenCost', () => {
  it('should return standard cost for 3d_generation without quality', () => {
    expect(getTokenCost('3d_generation')).toBe(TOKEN_COSTS['3d_generation_standard']);
  });

  it('should return high cost for 3d_generation with high quality', () => {
    expect(getTokenCost('3d_generation', 'high')).toBe(TOKEN_COSTS['3d_generation_high']);
  });

  it('should return short cost for chat_message without quality', () => {
    expect(getTokenCost('chat_message')).toBe(TOKEN_COSTS.chat_short);
  });

  it('should return long cost for chat_message with long quality', () => {
    expect(getTokenCost('chat_message', 'long')).toBe(TOKEN_COSTS.chat_long);
  });

  it('should lookup direct operation costs', () => {
    expect(getTokenCost('texture_generation')).toBe(TOKEN_COSTS.texture_generation);
    expect(getTokenCost('voice_generation')).toBe(TOKEN_COSTS.voice_generation);
    expect(getTokenCost('music_generation')).toBe(TOKEN_COSTS.music_generation);
    expect(getTokenCost('sfx_generation')).toBe(TOKEN_COSTS.sfx_generation);
    expect(getTokenCost('skybox_generation')).toBe(TOKEN_COSTS.skybox_generation);
  });

  it('should return 0 for unknown operations', () => {
    expect(getTokenCost('unknown_operation')).toBe(0);
    expect(getTokenCost('')).toBe(0);
  });
});
