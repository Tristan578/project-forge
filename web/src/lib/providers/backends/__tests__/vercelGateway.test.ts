/**
 * Tests for the Vercel AI Gateway provider backend.
 *
 * Covers: configuration detection (API key, VERCEL env, VERCEL_ENV env),
 * API key resolution, OIDC auth path, endpoint, model ID mapping,
 * default models export, capabilities, and metadata.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('vercelGatewayBackend', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('VERCEL_ENV', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('isConfigured', () => {
    it('returns false when no relevant env vars are set', async () => {
      const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
      expect(vercelGatewayBackend.isConfigured()).toBe(false);
    });

    it('returns true when AI_GATEWAY_API_KEY is set', async () => {
      vi.stubEnv('AI_GATEWAY_API_KEY', 'gw-test-key');
      const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
      expect(vercelGatewayBackend.isConfigured()).toBe(true);
    });

    it('returns true when VERCEL env is set (OIDC auto-auth)', async () => {
      vi.stubEnv('VERCEL', '1');
      const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
      expect(vercelGatewayBackend.isConfigured()).toBe(true);
    });

    it('returns true when VERCEL_ENV is set', async () => {
      vi.stubEnv('VERCEL_ENV', 'production');
      const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
      expect(vercelGatewayBackend.isConfigured()).toBe(true);
    });

    it('returns true when VERCEL_ENV is preview', async () => {
      vi.stubEnv('VERCEL_ENV', 'preview');
      const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
      expect(vercelGatewayBackend.isConfigured()).toBe(true);
    });

    it('returns true when both API key and VERCEL env are set', async () => {
      vi.stubEnv('AI_GATEWAY_API_KEY', 'gw-key');
      vi.stubEnv('VERCEL', '1');
      const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
      expect(vercelGatewayBackend.isConfigured()).toBe(true);
    });

    it('returns false when AI_GATEWAY_API_KEY is empty string', async () => {
      vi.stubEnv('AI_GATEWAY_API_KEY', '');
      const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
      expect(vercelGatewayBackend.isConfigured()).toBe(false);
    });
  });

  describe('getApiKey', () => {
    it('returns the gateway API key when set', async () => {
      vi.stubEnv('AI_GATEWAY_API_KEY', 'gw-abc123');
      const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
      expect(vercelGatewayBackend.getApiKey()).toBe('gw-abc123');
    });

    it('returns empty string when no API key (OIDC path)', async () => {
      vi.stubEnv('VERCEL', '1');
      const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
      expect(vercelGatewayBackend.getApiKey()).toBe('');
    });

    it('returns empty string when nothing is configured', async () => {
      const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
      expect(vercelGatewayBackend.getApiKey()).toBe('');
    });
  });

  describe('getEndpoint', () => {
    it('returns the Vercel AI Gateway endpoint', async () => {
      const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
      expect(vercelGatewayBackend.getEndpoint()).toBe('https://ai-gateway.vercel.sh/v1');
    });
  });

  describe('resolveModelId', () => {
    it('maps Anthropic canonical models to gateway format', async () => {
      const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
      expect(vercelGatewayBackend.resolveModelId('claude-sonnet-4-6')).toBe('anthropic/claude-sonnet-4-6');
      expect(vercelGatewayBackend.resolveModelId('claude-opus-4')).toBe('anthropic/claude-opus-4');
      expect(vercelGatewayBackend.resolveModelId('claude-haiku-3-5')).toBe('anthropic/claude-haiku-3-5');
    });

    it('maps premium and fast Anthropic models so they do not silently downgrade', async () => {
      // Regression for PR #8508 Sentry CRITICAL: missing entries here would
      // cause the gateway to fall back to DEFAULT_MODELS.chat (Sonnet) for
      // Pro users requesting the premium model — billed for Opus 4.7 but
      // routed to Sonnet 4.6.
      const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
      expect(vercelGatewayBackend.resolveModelId('claude-opus-4-7')).toBe('anthropic/claude-opus-4-7');
      expect(vercelGatewayBackend.resolveModelId('claude-haiku-4-5')).toBe('anthropic/claude-haiku-4-5');
      expect(vercelGatewayBackend.resolveModelId('claude-haiku-4-5-20251001')).toBe('anthropic/claude-haiku-4-5');
    });

    it('maps OpenAI canonical models to gateway format', async () => {
      const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
      expect(vercelGatewayBackend.resolveModelId('gpt-4o')).toBe('openai/gpt-4o');
      expect(vercelGatewayBackend.resolveModelId('gpt-4o-mini')).toBe('openai/gpt-4o-mini');
      expect(vercelGatewayBackend.resolveModelId('dall-e-3')).toBe('openai/dall-e-3');
    });

    it('maps Google canonical models to gateway format', async () => {
      const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
      expect(vercelGatewayBackend.resolveModelId('gemini-2-flash')).toBe('google/gemini-2.0-flash');
      expect(vercelGatewayBackend.resolveModelId('gemini-embedding-2-preview')).toBe('google/gemini-embedding-2-preview');
    });

    it('passes through already-namespaced model IDs with slash', async () => {
      const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
      expect(vercelGatewayBackend.resolveModelId('anthropic/custom-model')).toBe('anthropic/custom-model');
      expect(vercelGatewayBackend.resolveModelId('openai/gpt-5')).toBe('openai/gpt-5');
      expect(vercelGatewayBackend.resolveModelId('google/gemini-3')).toBe('google/gemini-3');
    });

    it('falls back to default chat model for unknown non-namespaced models', async () => {
      const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
      expect(vercelGatewayBackend.resolveModelId('unknown-model')).toBe('anthropic/claude-sonnet-4-6');
    });

    it('falls back to default chat model for empty string', async () => {
      const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
      expect(vercelGatewayBackend.resolveModelId('')).toBe('anthropic/claude-sonnet-4-6');
    });
  });

  describe('capabilities', () => {
    it('supports chat, embedding, and image', async () => {
      const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
      expect(vercelGatewayBackend.capabilities).toContain('chat');
      expect(vercelGatewayBackend.capabilities).toContain('embedding');
      expect(vercelGatewayBackend.capabilities).toContain('image');
    });

    it('does not support asset generation capabilities', async () => {
      const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
      expect(vercelGatewayBackend.capabilities).not.toContain('model3d');
      expect(vercelGatewayBackend.capabilities).not.toContain('texture');
      expect(vercelGatewayBackend.capabilities).not.toContain('sfx');
      expect(vercelGatewayBackend.capabilities).not.toContain('voice');
      expect(vercelGatewayBackend.capabilities).not.toContain('music');
      expect(vercelGatewayBackend.capabilities).not.toContain('sprite');
      expect(vercelGatewayBackend.capabilities).not.toContain('bg_removal');
    });

    it('has exactly 3 capabilities', async () => {
      const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
      expect(vercelGatewayBackend.capabilities).toHaveLength(3);
    });
  });

  describe('metadata', () => {
    it('has correct id and name', async () => {
      const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
      expect(vercelGatewayBackend.id).toBe('vercel-gateway');
      expect(vercelGatewayBackend.name).toBe('Vercel AI Gateway');
    });
  });
});

describe('vercelGatewayDefaultModels', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports default models for chat, embedding, and image', async () => {
    const { vercelGatewayDefaultModels } = await import('@/lib/providers/backends/vercelGateway');
    expect(vercelGatewayDefaultModels.chat).toBe('anthropic/claude-sonnet-4-6');
    expect(vercelGatewayDefaultModels.embedding).toBe('google/gemini-embedding-2-preview');
    expect(vercelGatewayDefaultModels.image).toBe('openai/dall-e-3');
  });

  it('has exactly 3 default model entries', async () => {
    const { vercelGatewayDefaultModels } = await import('@/lib/providers/backends/vercelGateway');
    expect(Object.keys(vercelGatewayDefaultModels)).toHaveLength(3);
  });
});
