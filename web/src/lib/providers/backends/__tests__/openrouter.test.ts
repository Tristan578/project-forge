/**
 * Tests for the OpenRouter provider backend.
 *
 * Covers: configuration detection, API key resolution, endpoint,
 * model ID mapping (known, passthrough, fallback), capabilities, and metadata.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('openrouterBackend', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('OPENROUTER_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('isConfigured', () => {
    it('returns false when OPENROUTER_API_KEY is not set', async () => {
      const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
      expect(openrouterBackend.isConfigured()).toBe(false);
    });

    it('returns true when OPENROUTER_API_KEY is set', async () => {
      vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test-123');
      const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
      expect(openrouterBackend.isConfigured()).toBe(true);
    });

    it('returns false when OPENROUTER_API_KEY is empty string', async () => {
      vi.stubEnv('OPENROUTER_API_KEY', '');
      const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
      expect(openrouterBackend.isConfigured()).toBe(false);
    });
  });

  describe('getApiKey', () => {
    it('returns the API key when set', async () => {
      vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-abc123');
      const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
      expect(openrouterBackend.getApiKey()).toBe('sk-or-abc123');
    });

    it('returns empty string when key is not set', async () => {
      const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
      expect(openrouterBackend.getApiKey()).toBe('');
    });
  });

  describe('getEndpoint', () => {
    it('returns the OpenRouter API endpoint', async () => {
      const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
      expect(openrouterBackend.getEndpoint()).toBe('https://openrouter.ai/api/v1');
    });
  });

  describe('resolveModelId', () => {
    it('maps Anthropic canonical models to OpenRouter format', async () => {
      const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
      expect(openrouterBackend.resolveModelId('claude-sonnet-4-6')).toBe('anthropic/claude-sonnet-4-6');
      expect(openrouterBackend.resolveModelId('claude-opus-4')).toBe('anthropic/claude-opus-4');
      expect(openrouterBackend.resolveModelId('claude-haiku-3-5')).toBe('anthropic/claude-haiku-3-5');
    });

    it('maps OpenAI canonical models to OpenRouter format', async () => {
      const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
      expect(openrouterBackend.resolveModelId('gpt-4o')).toBe('openai/gpt-4o');
      expect(openrouterBackend.resolveModelId('gpt-4o-mini')).toBe('openai/gpt-4o-mini');
      expect(openrouterBackend.resolveModelId('dall-e-3')).toBe('openai/dall-e-3');
    });

    it('maps Google canonical models to OpenRouter format', async () => {
      const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
      expect(openrouterBackend.resolveModelId('gemini-2-flash')).toBe('google/gemini-2.0-flash-exp:free');
      expect(openrouterBackend.resolveModelId('gemini-pro')).toBe('google/gemini-pro');
    });

    it('maps Meta canonical models to OpenRouter format', async () => {
      const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
      expect(openrouterBackend.resolveModelId('llama-3-70b')).toBe('meta-llama/llama-3-70b-instruct');
      expect(openrouterBackend.resolveModelId('llama-3-8b')).toBe('meta-llama/llama-3-8b-instruct:free');
    });

    it('maps Mistral canonical models to OpenRouter format', async () => {
      const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
      expect(openrouterBackend.resolveModelId('mistral-large')).toBe('mistralai/mistral-large');
      expect(openrouterBackend.resolveModelId('mistral-7b')).toBe('mistralai/mistral-7b-instruct:free');
    });

    it('passes through already-namespaced model IDs with slash', async () => {
      const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
      expect(openrouterBackend.resolveModelId('anthropic/custom-model')).toBe('anthropic/custom-model');
      expect(openrouterBackend.resolveModelId('openai/gpt-5')).toBe('openai/gpt-5');
    });

    it('falls back to default model for unknown non-namespaced models', async () => {
      const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
      expect(openrouterBackend.resolveModelId('unknown-model')).toBe('anthropic/claude-sonnet-4-6');
    });

    it('falls back to default model for empty string', async () => {
      const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
      expect(openrouterBackend.resolveModelId('')).toBe('anthropic/claude-sonnet-4-6');
    });
  });

  describe('capabilities', () => {
    it('supports chat, embedding, and image', async () => {
      const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
      expect(openrouterBackend.capabilities).toContain('chat');
      expect(openrouterBackend.capabilities).toContain('embedding');
      expect(openrouterBackend.capabilities).toContain('image');
    });

    it('does not support asset generation capabilities', async () => {
      const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
      expect(openrouterBackend.capabilities).not.toContain('model3d');
      expect(openrouterBackend.capabilities).not.toContain('texture');
      expect(openrouterBackend.capabilities).not.toContain('sfx');
      expect(openrouterBackend.capabilities).not.toContain('voice');
      expect(openrouterBackend.capabilities).not.toContain('music');
      expect(openrouterBackend.capabilities).not.toContain('sprite');
      expect(openrouterBackend.capabilities).not.toContain('bg_removal');
    });

    it('has exactly 3 capabilities', async () => {
      const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
      expect(openrouterBackend.capabilities).toHaveLength(3);
    });
  });

  describe('metadata', () => {
    it('has correct id and name', async () => {
      const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
      expect(openrouterBackend.id).toBe('openrouter');
      expect(openrouterBackend.name).toBe('OpenRouter');
    });
  });
});
