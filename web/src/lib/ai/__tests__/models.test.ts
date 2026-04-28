import { describe, it, expect } from 'vitest';
import {
  AI_MODEL_PRIMARY,
  AI_MODEL_FAST,
  AI_MODEL_PREMIUM,
  AI_MODEL_DEEP,
  AI_MODELS,
  GATEWAY_MODEL_PREMIUM,
  GATEWAY_MODEL_DEEP,
  isPremiumModel,
} from '../models';

describe('AI model constants', () => {
  it('exports AI_MODEL_PRIMARY as a non-empty string', () => {
    expect(typeof AI_MODEL_PRIMARY).toBe('string');
    expect(AI_MODEL_PRIMARY.length).toBeGreaterThan(0);
  });

  it('exports AI_MODEL_FAST as a non-empty string', () => {
    expect(typeof AI_MODEL_FAST).toBe('string');
    expect(AI_MODEL_FAST.length).toBeGreaterThan(0);
  });

  it('AI_MODEL_PRIMARY and AI_MODEL_FAST are different models', () => {
    expect(AI_MODEL_PRIMARY).not.toBe(AI_MODEL_FAST);
  });

  it('AI_MODEL_PRIMARY matches expected claude-sonnet pattern', () => {
    // Validates the model ID follows the Anthropic naming convention.
    // Update this pattern if Anthropic changes their naming scheme.
    expect(AI_MODEL_PRIMARY).toMatch(/^claude-/);
  });

  it('AI_MODEL_FAST matches expected claude-haiku pattern', () => {
    expect(AI_MODEL_FAST).toMatch(/^claude-/);
  });

  it('exports AI_MODEL_DEEP as a non-empty claude-* string', () => {
    expect(typeof AI_MODEL_DEEP).toBe('string');
    expect(AI_MODEL_DEEP).toMatch(/^claude-/);
  });

  it('AI_MODEL_DEEP is distinct from primary and fast tiers', () => {
    expect(AI_MODEL_DEEP).not.toBe(AI_MODEL_PRIMARY);
    expect(AI_MODEL_DEEP).not.toBe(AI_MODEL_FAST);
  });

  it('GATEWAY_MODEL_DEEP uses provider-namespaced format', () => {
    expect(GATEWAY_MODEL_DEEP).toContain('/');
    expect(GATEWAY_MODEL_DEEP.split('/')[0]).toBe('anthropic');
  });
});

describe('AI_MODELS object', () => {
  it('has all required keys', () => {
    const requiredKeys = [
      'chat',
      'fast',
      'deep',
      'embedding',
      'gatewayChat',
      'gatewayEmbedding',
      'gatewayDeep',
      'githubDefault',
      'openrouterDefault',
    ] as const;

    for (const key of requiredKeys) {
      expect(AI_MODELS).toHaveProperty(key);
      expect(typeof AI_MODELS[key]).toBe('string');
      expect(AI_MODELS[key].length).toBeGreaterThan(0);
    }
  });

  it('chat key matches AI_MODEL_PRIMARY', () => {
    expect(AI_MODELS.chat).toBe(AI_MODEL_PRIMARY);
  });

  it('fast key matches AI_MODEL_FAST', () => {
    expect(AI_MODELS.fast).toBe(AI_MODEL_FAST);
  });

  it('deep key matches AI_MODEL_DEEP', () => {
    expect(AI_MODELS.deep).toBe(AI_MODEL_DEEP);
  });

  it('gatewayDeep matches GATEWAY_MODEL_DEEP', () => {
    expect(AI_MODELS.gatewayDeep).toBe(GATEWAY_MODEL_DEEP);
  });

  it('embedding key is a non-empty string', () => {
    expect(typeof AI_MODELS.embedding).toBe('string');
    expect(AI_MODELS.embedding.length).toBeGreaterThan(0);
  });

  it('gatewayChat uses provider-namespaced format', () => {
    // Gateway models must be in "provider/model" format for the Vercel AI Gateway
    expect(AI_MODELS.gatewayChat).toContain('/');
  });

  it('gatewayEmbedding uses provider-namespaced format', () => {
    expect(AI_MODELS.gatewayEmbedding).toContain('/');
  });

  it('openrouterDefault uses provider-namespaced format', () => {
    expect(AI_MODELS.openrouterDefault).toContain('/');
  });

  it('all values are strings of non-zero length', () => {
    const values = Object.values(AI_MODELS) as string[];
    for (const v of values) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it('exposes premium and gatewayPremium keys', () => {
    expect(AI_MODELS.premium).toBe(AI_MODEL_PREMIUM);
    expect(AI_MODELS.gatewayPremium).toBe(GATEWAY_MODEL_PREMIUM);
  });
});

describe('AI_MODEL_PREMIUM', () => {
  it('is a non-empty Anthropic-style model id', () => {
    expect(typeof AI_MODEL_PREMIUM).toBe('string');
    expect(AI_MODEL_PREMIUM).toMatch(/^claude-opus-/);
  });

  it('differs from primary and fast model ids', () => {
    expect(AI_MODEL_PREMIUM).not.toBe(AI_MODEL_PRIMARY);
    expect(AI_MODEL_PREMIUM).not.toBe(AI_MODEL_FAST);
  });

  it('has a corresponding gateway-format string', () => {
    expect(GATEWAY_MODEL_PREMIUM).toContain('/');
    expect(GATEWAY_MODEL_PREMIUM.endsWith(AI_MODEL_PREMIUM)).toBe(true);
  });
});

describe('isPremiumModel', () => {
  it('returns true for the bare premium id', () => {
    expect(isPremiumModel(AI_MODEL_PREMIUM)).toBe(true);
  });

  it('returns true for the gateway-format premium id', () => {
    expect(isPremiumModel(GATEWAY_MODEL_PREMIUM)).toBe(true);
  });

  it('returns false for the primary chat model', () => {
    expect(isPremiumModel(AI_MODEL_PRIMARY)).toBe(false);
    expect(isPremiumModel(AI_MODELS.gatewayChat)).toBe(false);
  });

  it('returns false for the fast model', () => {
    expect(isPremiumModel(AI_MODEL_FAST)).toBe(false);
  });

  it('returns false for null, undefined, and empty string', () => {
    expect(isPremiumModel(null)).toBe(false);
    expect(isPremiumModel(undefined)).toBe(false);
    expect(isPremiumModel('')).toBe(false);
  });

  it('returns false for an unknown opus-shaped string (no substring match)', () => {
    // Defensive: the helper should only allow exactly the known opus id, not
    // any string containing "opus". Future opus revisions must be opted in.
    expect(isPremiumModel('claude-opus-5-0')).toBe(false);
    expect(isPremiumModel('anthropic/claude-opus-9-9')).toBe(false);
    expect(isPremiumModel('opus-pretender')).toBe(false);
  });
});
