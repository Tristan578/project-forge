import { describe, it, expect } from 'vitest';
import { AI_MODEL_PRIMARY, AI_MODEL_FAST } from '../models';

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
