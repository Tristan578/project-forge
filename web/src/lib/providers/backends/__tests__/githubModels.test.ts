/**
 * Tests for the GitHub Models provider backend.
 *
 * Covers: configuration detection, API key resolution, endpoint,
 * model ID mapping (OpenAI, Meta, Mistral, Phi, Cohere, AI21, embeddings),
 * fallback behavior, capabilities, and metadata.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('githubModelsBackend', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('GITHUB_MODELS_PAT', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('isConfigured', () => {
    it('returns false when GITHUB_MODELS_PAT is not set', async () => {
      const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
      expect(githubModelsBackend.isConfigured()).toBe(false);
    });

    it('returns true when GITHUB_MODELS_PAT is set', async () => {
      vi.stubEnv('GITHUB_MODELS_PAT', 'ghp_test123');
      const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
      expect(githubModelsBackend.isConfigured()).toBe(true);
    });

    it('returns false when GITHUB_MODELS_PAT is empty string', async () => {
      vi.stubEnv('GITHUB_MODELS_PAT', '');
      const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
      expect(githubModelsBackend.isConfigured()).toBe(false);
    });
  });

  describe('getApiKey', () => {
    it('returns the PAT when set', async () => {
      vi.stubEnv('GITHUB_MODELS_PAT', 'ghp_secrettoken');
      const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
      expect(githubModelsBackend.getApiKey()).toBe('ghp_secrettoken');
    });

    it('returns empty string when PAT is not set', async () => {
      const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
      expect(githubModelsBackend.getApiKey()).toBe('');
    });
  });

  describe('getEndpoint', () => {
    it('returns the GitHub Models inference endpoint', async () => {
      const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
      expect(githubModelsBackend.getEndpoint()).toBe('https://models.inference.ai.azure.com');
    });
  });

  describe('resolveModelId', () => {
    it('maps OpenAI canonical models to deployment names', async () => {
      const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
      expect(githubModelsBackend.resolveModelId('gpt-4o')).toBe('gpt-4o');
      expect(githubModelsBackend.resolveModelId('gpt-4o-mini')).toBe('gpt-4o-mini');
      expect(githubModelsBackend.resolveModelId('o1-mini')).toBe('o1-mini');
      expect(githubModelsBackend.resolveModelId('o1-preview')).toBe('o1-preview');
    });

    it('maps Meta Llama canonical models to deployment names', async () => {
      const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
      expect(githubModelsBackend.resolveModelId('llama-3-70b')).toBe('Meta-Llama-3-70B-Instruct');
      expect(githubModelsBackend.resolveModelId('llama-3-8b')).toBe('Meta-Llama-3-8B-Instruct');
      expect(githubModelsBackend.resolveModelId('llama-3.2-90b')).toBe('Llama-3.2-90B-Vision-Instruct');
      expect(githubModelsBackend.resolveModelId('llama-3.2-11b')).toBe('Llama-3.2-11B-Vision-Instruct');
    });

    it('maps Mistral canonical models to deployment names', async () => {
      const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
      expect(githubModelsBackend.resolveModelId('mistral-large')).toBe('Mistral-large');
      expect(githubModelsBackend.resolveModelId('mistral-nemo')).toBe('Mistral-Nemo');
      expect(githubModelsBackend.resolveModelId('mistral-small')).toBe('Mistral-small');
    });

    it('maps Phi canonical models to deployment names', async () => {
      const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
      expect(githubModelsBackend.resolveModelId('phi-3-medium')).toBe('Phi-3-medium-128k-instruct');
      expect(githubModelsBackend.resolveModelId('phi-3-mini')).toBe('Phi-3-mini-128k-instruct');
      expect(githubModelsBackend.resolveModelId('phi-3.5-mini')).toBe('Phi-3.5-mini-instruct');
    });

    it('maps Cohere canonical models to deployment names', async () => {
      const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
      expect(githubModelsBackend.resolveModelId('cohere-r-plus')).toBe('Cohere-command-r-plus');
      expect(githubModelsBackend.resolveModelId('cohere-r')).toBe('Cohere-command-r');
    });

    it('maps AI21 canonical models to deployment names', async () => {
      const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
      expect(githubModelsBackend.resolveModelId('jamba-1.5-mini')).toBe('AI21-Jamba-1.5-Mini');
      expect(githubModelsBackend.resolveModelId('jamba-1.5-large')).toBe('AI21-Jamba-1.5-Large');
    });

    it('maps embedding canonical models to deployment names', async () => {
      const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
      expect(githubModelsBackend.resolveModelId('text-embedding-3-small')).toBe('text-embedding-3-small');
      expect(githubModelsBackend.resolveModelId('text-embedding-3-large')).toBe('text-embedding-3-large');
      expect(githubModelsBackend.resolveModelId('cohere-embed-v3')).toBe('Cohere-embed-v3-multilingual');
    });

    it('passes through unknown model names as-is', async () => {
      const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
      expect(githubModelsBackend.resolveModelId('some-unknown-model')).toBe('some-unknown-model');
    });

    it('falls back to default model when given empty string', async () => {
      const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
      expect(githubModelsBackend.resolveModelId('')).toBe('gpt-4o-mini');
    });
  });

  describe('capabilities', () => {
    it('supports chat and embedding only', async () => {
      const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
      expect(githubModelsBackend.capabilities).toContain('chat');
      expect(githubModelsBackend.capabilities).toContain('embedding');
    });

    it('does not support image or asset generation capabilities', async () => {
      const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
      expect(githubModelsBackend.capabilities).not.toContain('image');
      expect(githubModelsBackend.capabilities).not.toContain('model3d');
      expect(githubModelsBackend.capabilities).not.toContain('texture');
      expect(githubModelsBackend.capabilities).not.toContain('sfx');
      expect(githubModelsBackend.capabilities).not.toContain('voice');
      expect(githubModelsBackend.capabilities).not.toContain('music');
    });

    it('has exactly 2 capabilities', async () => {
      const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
      expect(githubModelsBackend.capabilities).toHaveLength(2);
    });
  });

  describe('metadata', () => {
    it('has correct id and name', async () => {
      const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
      expect(githubModelsBackend.id).toBe('github-models');
      expect(githubModelsBackend.name).toBe('GitHub Models');
    });
  });
});
