import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_MODEL_DEEP, AI_MODEL_PRIMARY } from '../models';

const trackEventMock = vi.fn();
vi.mock('@/lib/analytics/posthog', () => ({
  trackEvent: (name: string, props?: Record<string, unknown>) => trackEventMock(name, props),
}));

// Passthrough by default (returns the fallback, matching the dormant
// evaluator), but recordable/overridable so context forwarding and flag
// overrides are assertable without standing up the real flags cache.
const getBooleanFlagMock = vi.fn(
  (_key: string, fallback: boolean, _ctx?: { tier?: string }) => fallback,
);
vi.mock('@/lib/flags/posthogFlags', () => ({
  getBooleanFlag: (key: string, fallback: boolean, ctx?: { tier?: string }) =>
    getBooleanFlagMock(key, fallback, ctx),
}));

describe('deepTier', () => {
  const originalEnv = process.env.NEXT_PUBLIC_USE_DEEP_GENERATION;

  beforeEach(() => {
    trackEventMock.mockReset();
    getBooleanFlagMock.mockReset();
    getBooleanFlagMock.mockImplementation(
      (_key: string, fallback: boolean, _ctx?: { tier?: string }) => fallback,
    );
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_USE_DEEP_GENERATION = originalEnv;
  });

  describe('isDeepTierEnabled', () => {
    it('returns false when flag is unset', async () => {
      delete process.env.NEXT_PUBLIC_USE_DEEP_GENERATION;
      const { isDeepTierEnabled } = await import('../deepTier');
      expect(isDeepTierEnabled()).toBe(false);
    });

    it('returns true only when flag is exactly the string "true"', async () => {
      process.env.NEXT_PUBLIC_USE_DEEP_GENERATION = 'true';
      const { isDeepTierEnabled } = await import('../deepTier');
      expect(isDeepTierEnabled()).toBe(true);
    });

    it.each([
      ['1'],
      ['yes'],
      ['TRUE'],
      ['on'],
      [''],
      [' true '],
      ['false'],
    ])('returns false for non-exact-"true" value: %j', async (value) => {
      // Set env BEFORE resetModules so the fresh import reads the intended value.
      // Order matters: vi.resetModules() clears the cache, the next import re-reads process.env.
      process.env.NEXT_PUBLIC_USE_DEEP_GENERATION = value;
      vi.resetModules();
      const { isDeepTierEnabled } = await import('../deepTier');
      expect(isDeepTierEnabled()).toBe(false);
    });

    it('forwards the caller context to getBooleanFlag for per-tier targeting', async () => {
      delete process.env.NEXT_PUBLIC_USE_DEEP_GENERATION;
      const { isDeepTierEnabled } = await import('../deepTier');

      isDeepTierEnabled({ tier: 'pro' });

      expect(getBooleanFlagMock).toHaveBeenCalledWith(
        'deep-generation-tier',
        false,
        { tier: 'pro' },
      );
    });

    it('honors a flag override that differs from the env fallback', async () => {
      delete process.env.NEXT_PUBLIC_USE_DEEP_GENERATION;
      getBooleanFlagMock.mockReturnValue(true);
      const { isDeepTierEnabled } = await import('../deepTier');

      expect(isDeepTierEnabled({ tier: 'pro' })).toBe(true);
    });
  });

  describe('getDeepGenerationModel', () => {
    it('returns primary model when flag is off', async () => {
      delete process.env.NEXT_PUBLIC_USE_DEEP_GENERATION;
      const { getDeepGenerationModel } = await import('../deepTier');
      expect(getDeepGenerationModel('gdd')).toBe(AI_MODEL_PRIMARY);
    });

    it('returns deep model when flag is on', async () => {
      process.env.NEXT_PUBLIC_USE_DEEP_GENERATION = 'true';
      const { getDeepGenerationModel } = await import('../deepTier');
      expect(getDeepGenerationModel('gdd')).toBe(AI_MODEL_DEEP);
    });

    it('forwards the caller context through to the flag evaluation', async () => {
      delete process.env.NEXT_PUBLIC_USE_DEEP_GENERATION;
      const { getDeepGenerationModel } = await import('../deepTier');

      getDeepGenerationModel('gdd', { tier: 'starter' });

      expect(getBooleanFlagMock).toHaveBeenCalledWith(
        'deep-generation-tier',
        false,
        { tier: 'starter' },
      );
    });

    it('emits ai_deep_generation_eval with surface and model', async () => {
      process.env.NEXT_PUBLIC_USE_DEEP_GENERATION = 'true';
      const { getDeepGenerationModel } = await import('../deepTier');

      getDeepGenerationModel('world_builder');

      expect(trackEventMock).toHaveBeenCalledWith('ai_deep_generation_eval', {
        surface: 'world_builder',
        model: AI_MODEL_DEEP,
        deepTierEnabled: true,
      });
    });

    it('emits the event even when flag is off so both arms are measurable', async () => {
      delete process.env.NEXT_PUBLIC_USE_DEEP_GENERATION;
      const { getDeepGenerationModel } = await import('../deepTier');

      getDeepGenerationModel('cutscene');

      expect(trackEventMock).toHaveBeenCalledWith('ai_deep_generation_eval', {
        surface: 'cutscene',
        model: AI_MODEL_PRIMARY,
        deepTierEnabled: false,
      });
    });
  });
});
