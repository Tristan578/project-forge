/**
 * Integration tests locking in the deep-tier linkage: each deep-generation
 * surface (GDD, world builder, cutscene) MUST pass the model string returned
 * by `getDeepGenerationModel()` through to `fetchAI`.
 *
 * Without these, a refactor that replaces the helper with a hardcoded
 * constant, or drops the `model` key, would pass every per-module unit test
 * while silently breaking the feature flag.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_MODEL_DEEP, AI_MODEL_PRIMARY } from '../models';

const fetchAIMock = vi.fn();
vi.mock('@/lib/ai/client', () => ({
  fetchAI: (prompt: string, options?: Record<string, unknown>) =>
    fetchAIMock(prompt, options),
}));

const trackEventMock = vi.fn();
vi.mock('@/lib/analytics/posthog', () => ({
  trackEvent: (name: string, props?: Record<string, unknown>) =>
    trackEventMock(name, props),
}));

function getLastModel(): unknown {
  const lastCall = fetchAIMock.mock.calls.at(-1);
  const options = lastCall?.[1] as Record<string, unknown> | undefined;
  return options?.model;
}

describe('deep-tier integration', () => {
  const originalEnv = process.env.NEXT_PUBLIC_USE_DEEP_GENERATION;

  beforeEach(() => {
    fetchAIMock.mockReset();
    trackEventMock.mockReset();
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_USE_DEEP_GENERATION = originalEnv;
  });

  describe('flag off — routes to AI_MODEL_PRIMARY', () => {
    beforeEach(() => {
      delete process.env.NEXT_PUBLIC_USE_DEEP_GENERATION;
    });

    it('gddGenerator passes AI_MODEL_PRIMARY to fetchAI', async () => {
      fetchAIMock.mockResolvedValue(JSON.stringify({
        title: 'Stub',
        logline: 'Stub logline',
        sections: [],
      }));

      const { generateGDD } = await import('../gddGenerator');
      await generateGDD('a puzzle game').catch(() => {
        // parse errors don't matter — we only care about the fetchAI call
      });

      expect(fetchAIMock).toHaveBeenCalled();
      expect(getLastModel()).toBe(AI_MODEL_PRIMARY);
    });

    it('worldBuilder passes AI_MODEL_PRIMARY to fetchAI', async () => {
      fetchAIMock.mockResolvedValue('{}');

      const { generateWorld } = await import('../worldBuilder');
      await generateWorld('a fantasy world', 'high_fantasy').catch(() => {
        // parse errors don't matter
      });

      expect(fetchAIMock).toHaveBeenCalled();
      expect(getLastModel()).toBe(AI_MODEL_PRIMARY);
    });

    it('cutsceneGenerator passes AI_MODEL_PRIMARY to fetchAI', async () => {
      fetchAIMock.mockResolvedValue(JSON.stringify({
        name: 'Stub',
        duration: 5,
        tracks: [{
          id: 't1',
          type: 'camera',
          keyframes: [{ timestamp: 0, duration: 1 }],
        }],
      }));

      const { generateCutscene } = await import('../cutsceneGenerator');
      await generateCutscene({
        prompt: 'pan the sky',
        sceneEntities: [],
        duration: 5,
      }).catch(() => {
        // parse errors don't matter
      });

      expect(fetchAIMock).toHaveBeenCalled();
      expect(getLastModel()).toBe(AI_MODEL_PRIMARY);
    });
  });

  describe('flag on — routes to AI_MODEL_DEEP', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_USE_DEEP_GENERATION = 'true';
    });

    it('gddGenerator passes AI_MODEL_DEEP to fetchAI', async () => {
      fetchAIMock.mockResolvedValue(JSON.stringify({
        title: 'Stub',
        logline: 'Stub logline',
        sections: [],
      }));

      const { generateGDD } = await import('../gddGenerator');
      await generateGDD('a puzzle game').catch(() => {});

      expect(getLastModel()).toBe(AI_MODEL_DEEP);
    });

    it('worldBuilder passes AI_MODEL_DEEP to fetchAI', async () => {
      fetchAIMock.mockResolvedValue('{}');

      const { generateWorld } = await import('../worldBuilder');
      await generateWorld('a fantasy world', 'high_fantasy').catch(() => {});

      expect(getLastModel()).toBe(AI_MODEL_DEEP);
    });

    it('cutsceneGenerator passes AI_MODEL_DEEP to fetchAI', async () => {
      fetchAIMock.mockResolvedValue(JSON.stringify({
        name: 'Stub',
        duration: 5,
        tracks: [{
          id: 't1',
          type: 'camera',
          keyframes: [{ timestamp: 0, duration: 1 }],
        }],
      }));

      const { generateCutscene } = await import('../cutsceneGenerator');
      await generateCutscene({
        prompt: 'pan the sky',
        sceneEntities: [],
        duration: 5,
      }).catch(() => {});

      expect(getLastModel()).toBe(AI_MODEL_DEEP);
    });
  });

  it('emits ai_deep_generation_eval exactly once per generation', async () => {
    delete process.env.NEXT_PUBLIC_USE_DEEP_GENERATION;
    fetchAIMock.mockResolvedValue(JSON.stringify({
      name: 'Stub',
      duration: 5,
      tracks: [{
        id: 't1',
        type: 'camera',
        keyframes: [{ timestamp: 0, duration: 1 }],
      }],
    }));

    const { generateCutscene } = await import('../cutsceneGenerator');
    await generateCutscene({
      prompt: 'pan the sky',
      sceneEntities: [],
      duration: 5,
    }).catch(() => {});

    const deepEvents = trackEventMock.mock.calls.filter(
      ([name]) => name === 'ai_deep_generation_eval',
    );
    expect(deepEvents).toHaveLength(1);
    expect(deepEvents[0]?.[1]).toMatchObject({
      surface: 'cutscene',
      model: AI_MODEL_PRIMARY,
      deepTierEnabled: false,
    });
  });
});
