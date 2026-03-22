import { describe, it, expect } from 'vitest';
import { AI_MODEL_PRIMARY, AI_MODEL_FAST, AI_MODELS } from '../models';

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
});

describe('AI_MODELS object', () => {
  it('has all required keys', () => {
    const requiredKeys = [
      'chat',
      'fast',
      'embedding',
      'gatewayChat',
      'gatewayEmbedding',
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
});
