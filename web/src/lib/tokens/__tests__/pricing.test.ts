import { describe, it, expect } from 'vitest';
import {
  TOKEN_COSTS,
  TIER_MONTHLY_TOKENS,
  TOKEN_PACKAGES,
  getTokenCost,
  type OperationType,
  type TokenPackage,
} from '../pricing';

describe('TOKEN_COSTS', () => {
  it('should have positive costs for all operations', () => {
    for (const [key, cost] of Object.entries(TOKEN_COSTS)) {
      expect(cost, `${key} should be positive`).toBeGreaterThan(0);
    }
  });

  it('should have all costs as integers', () => {
    for (const [key, cost] of Object.entries(TOKEN_COSTS)) {
      expect(Number.isInteger(cost), `${key} should be integer`).toBe(true);
    }
  });

  it('should have expected chat operations defined', () => {
    expect(TOKEN_COSTS.chat_short).toBe(5);
    expect(TOKEN_COSTS.chat_long).toBe(15);
    expect(TOKEN_COSTS.chat_standard).toBe(1);
    expect(TOKEN_COSTS.chat_premium).toBe(5);
    expect(TOKEN_COSTS.chat_premium_opus).toBe(15);
  });

  it('should have expected generation operations defined', () => {
    expect(TOKEN_COSTS['3d_generation_standard']).toBe(100);
    expect(TOKEN_COSTS['3d_generation_high']).toBe(200);
    expect(TOKEN_COSTS.texture_generation).toBe(30);
    expect(TOKEN_COSTS.image_to_3d).toBe(150);
    expect(TOKEN_COSTS.voice_generation).toBe(40);
    expect(TOKEN_COSTS.music_generation).toBe(80);
    expect(TOKEN_COSTS.sfx_generation).toBe(20);
    expect(TOKEN_COSTS.skybox_generation).toBe(50);
  });

  it('should have compound operation costs', () => {
    expect(TOKEN_COSTS.compound_scene_simple).toBe(50);
    expect(TOKEN_COSTS.compound_scene_complex).toBe(300);
  });

  it('should have high quality cost more than standard for 3D', () => {
    expect(TOKEN_COSTS['3d_generation_high']).toBeGreaterThan(TOKEN_COSTS['3d_generation_standard']);
  });

  it('should have music cost more than sfx', () => {
    expect(TOKEN_COSTS.music_generation).toBeGreaterThan(TOKEN_COSTS.sfx_generation);
  });

  it('should have at least 14 operation types', () => {
    expect(Object.keys(TOKEN_COSTS).length).toBeGreaterThanOrEqual(14);
  });
});

describe('TIER_MONTHLY_TOKENS', () => {
  it('should have ascending token allocations', () => {
    expect(TIER_MONTHLY_TOKENS.starter).toBeLessThan(TIER_MONTHLY_TOKENS.hobbyist);
    expect(TIER_MONTHLY_TOKENS.hobbyist).toBeLessThan(TIER_MONTHLY_TOKENS.creator);
    expect(TIER_MONTHLY_TOKENS.creator).toBeLessThan(TIER_MONTHLY_TOKENS.pro);
  });

  it('should have all tiers defined with correct values', () => {
    expect(TIER_MONTHLY_TOKENS.starter).toBe(50);
    expect(TIER_MONTHLY_TOKENS.hobbyist).toBe(300);
    expect(TIER_MONTHLY_TOKENS.creator).toBe(1000);
    expect(TIER_MONTHLY_TOKENS.pro).toBe(3000);
  });

  it('should have exactly four tiers', () => {
    expect(Object.keys(TIER_MONTHLY_TOKENS)).toHaveLength(4);
  });

  it('should have all positive integer allocations', () => {
    for (const [, tokens] of Object.entries(TIER_MONTHLY_TOKENS)) {
      expect(tokens).toBeGreaterThan(0);
      expect(Number.isInteger(tokens)).toBe(true);
    }
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

  it('should have correct spark package values', () => {
    expect(TOKEN_PACKAGES.spark.tokens).toBe(1000);
    expect(TOKEN_PACKAGES.spark.priceCents).toBe(1200);
    expect(TOKEN_PACKAGES.spark.label).toBe('Spark');
  });

  it('should have correct blaze package values', () => {
    expect(TOKEN_PACKAGES.blaze.tokens).toBe(5000);
    expect(TOKEN_PACKAGES.blaze.priceCents).toBe(4900);
    expect(TOKEN_PACKAGES.blaze.label).toBe('Blaze');
  });

  it('should have correct inferno package values', () => {
    expect(TOKEN_PACKAGES.inferno.tokens).toBe(20000);
    expect(TOKEN_PACKAGES.inferno.priceCents).toBe(14900);
    expect(TOKEN_PACKAGES.inferno.label).toBe('Inferno');
  });

  it('should have exactly three packages', () => {
    expect(Object.keys(TOKEN_PACKAGES)).toHaveLength(3);
  });

  it('should have each package with tokens, priceCents, and label', () => {
    for (const [, pkg] of Object.entries(TOKEN_PACKAGES)) {
      expect(pkg).toHaveProperty('tokens');
      expect(pkg).toHaveProperty('priceCents');
      expect(pkg).toHaveProperty('label');
      expect(typeof pkg.tokens).toBe('number');
      expect(typeof pkg.priceCents).toBe('number');
      expect(typeof pkg.label).toBe('string');
    }
  });
});

describe('getTokenCost', () => {
  it('should return standard cost for 3d_generation without quality', () => {
    expect(getTokenCost('3d_generation')).toBe(TOKEN_COSTS['3d_generation_standard']);
  });

  it('should return standard cost for 3d_generation with explicit standard quality', () => {
    expect(getTokenCost('3d_generation', 'standard')).toBe(TOKEN_COSTS['3d_generation_standard']);
  });

  it('should return high cost for 3d_generation with high quality', () => {
    expect(getTokenCost('3d_generation', 'high')).toBe(TOKEN_COSTS['3d_generation_high']);
  });

  it('should return standard cost for 3d_generation with unknown quality', () => {
    expect(getTokenCost('3d_generation', 'ultra')).toBe(TOKEN_COSTS['3d_generation_standard']);
  });

  it('should return short cost for chat_message without quality', () => {
    expect(getTokenCost('chat_message')).toBe(TOKEN_COSTS.chat_short);
  });

  it('should return short cost for chat_message with explicit short quality', () => {
    expect(getTokenCost('chat_message', 'short')).toBe(TOKEN_COSTS.chat_short);
  });

  it('should return long cost for chat_message with long quality', () => {
    expect(getTokenCost('chat_message', 'long')).toBe(TOKEN_COSTS.chat_long);
  });

  it('should return short cost for chat_message with unknown quality', () => {
    expect(getTokenCost('chat_message', 'medium')).toBe(TOKEN_COSTS.chat_short);
  });

  it('should lookup direct operation costs', () => {
    expect(getTokenCost('texture_generation')).toBe(TOKEN_COSTS.texture_generation);
    expect(getTokenCost('voice_generation')).toBe(TOKEN_COSTS.voice_generation);
    expect(getTokenCost('music_generation')).toBe(TOKEN_COSTS.music_generation);
    expect(getTokenCost('sfx_generation')).toBe(TOKEN_COSTS.sfx_generation);
    expect(getTokenCost('skybox_generation')).toBe(TOKEN_COSTS.skybox_generation);
    expect(getTokenCost('image_to_3d')).toBe(TOKEN_COSTS.image_to_3d);
  });

  it('should return correct cost for compound operations', () => {
    expect(getTokenCost('compound_scene_simple')).toBe(TOKEN_COSTS.compound_scene_simple);
    expect(getTokenCost('compound_scene_complex')).toBe(TOKEN_COSTS.compound_scene_complex);
  });

  it('should return 0 for unknown operations', () => {
    expect(getTokenCost('unknown_operation')).toBe(0);
    expect(getTokenCost('')).toBe(0);
  });

  it('should return 0 for free scene-editing operations', () => {
    expect(getTokenCost('transform_update')).toBe(0);
    expect(getTokenCost('entity_select')).toBe(0);
    expect(getTokenCost('scene_save')).toBe(0);
  });

  it('should ignore quality param for non-variant operations', () => {
    expect(getTokenCost('texture_generation', 'high')).toBe(TOKEN_COSTS.texture_generation);
    expect(getTokenCost('sfx_generation', 'low')).toBe(TOKEN_COSTS.sfx_generation);
  });
});

describe('type exports', () => {
  it('OperationType covers all TOKEN_COSTS keys', () => {
    const keys = Object.keys(TOKEN_COSTS);
    keys.forEach((key) => {
      const op: OperationType = key as OperationType;
      expect(TOKEN_COSTS[op]).not.toBeUndefined();
    });
  });

  it('TokenPackage covers all TOKEN_PACKAGES keys', () => {
    const keys = Object.keys(TOKEN_PACKAGES) as TokenPackage[];
    keys.forEach((key) => {
      expect(TOKEN_PACKAGES[key]).not.toBeUndefined();
    });
  });
});
