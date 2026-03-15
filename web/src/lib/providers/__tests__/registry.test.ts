/**
 * Tests for the unified AI provider registry.
 *
 * Covers: priority resolution, capability checking, preferred backend override,
 * fallthrough, empty config, model selection, and each backend individually.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// We stub process.env before importing the modules under test so the
// module-level isConfigured() calls read our values.
const envBackup = { ...process.env };

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

function clearAllProviderEnv(): void {
  const keys = [
    'AI_GATEWAY_API_KEY',
    'VERCEL',
    'VERCEL_ENV',
    'OPENROUTER_API_KEY',
    'GITHUB_MODELS_PAT',
    'PLATFORM_ANTHROPIC_KEY',
    'PLATFORM_OPENAI_KEY',
    'PLATFORM_MESHY_KEY',
    'PLATFORM_HYPER3D_KEY',
    'PLATFORM_ELEVENLABS_KEY',
    'PLATFORM_SUNO_KEY',
    'PLATFORM_REPLICATE_KEY',
    'PLATFORM_REMOVEBG_KEY',
  ];
  for (const k of keys) {
    delete process.env[k];
  }
}

// Registry and backends are re-imported inside each test group to pick up env changes.
// Using vi.resetModules() + dynamic imports.

describe('vercelGatewayBackend', () => {
  beforeEach(() => {
    clearAllProviderEnv();
    vi.resetModules();
  });

  afterEach(() => {
    Object.assign(process.env, envBackup);
  });

  it('reports not configured when no key or VERCEL env', async () => {
    const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
    expect(vercelGatewayBackend.isConfigured()).toBe(false);
  });

  it('reports configured when AI_GATEWAY_API_KEY is set', async () => {
    setEnv({ AI_GATEWAY_API_KEY: 'test-key' });
    const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
    expect(vercelGatewayBackend.isConfigured()).toBe(true);
  });

  it('reports configured when VERCEL env is set (OIDC auto-auth)', async () => {
    setEnv({ VERCEL: '1' });
    const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
    expect(vercelGatewayBackend.isConfigured()).toBe(true);
  });

  it('reports configured when VERCEL_ENV is set', async () => {
    setEnv({ VERCEL_ENV: 'production' });
    const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
    expect(vercelGatewayBackend.isConfigured()).toBe(true);
  });

  it('returns the API key', async () => {
    setEnv({ AI_GATEWAY_API_KEY: 'gw-abc123' });
    const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
    expect(vercelGatewayBackend.getApiKey()).toBe('gw-abc123');
  });

  it('returns empty string when no key (OIDC path)', async () => {
    setEnv({ VERCEL: '1' });
    const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
    expect(vercelGatewayBackend.getApiKey()).toBe('');
  });

  it('returns correct endpoint', async () => {
    const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
    expect(vercelGatewayBackend.getEndpoint()).toBe('https://ai-gateway.vercel.sh/v1');
  });

  it('maps known canonical model names', async () => {
    const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
    expect(vercelGatewayBackend.resolveModelId('claude-sonnet-4-6')).toBe('anthropic/claude-sonnet-4-6');
    expect(vercelGatewayBackend.resolveModelId('gpt-4o')).toBe('openai/gpt-4o');
    expect(vercelGatewayBackend.resolveModelId('gemini-embedding-2-preview')).toBe('google/gemini-embedding-2-preview');
  });

  it('passes through already-namespaced model IDs', async () => {
    const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
    expect(vercelGatewayBackend.resolveModelId('anthropic/custom-model')).toBe('anthropic/custom-model');
  });

  it('has chat, embedding, image capabilities', async () => {
    const { vercelGatewayBackend } = await import('@/lib/providers/backends/vercelGateway');
    expect(vercelGatewayBackend.capabilities).toContain('chat');
    expect(vercelGatewayBackend.capabilities).toContain('embedding');
    expect(vercelGatewayBackend.capabilities).toContain('image');
    expect(vercelGatewayBackend.capabilities).not.toContain('model3d');
  });
});

describe('openrouterBackend', () => {
  beforeEach(() => {
    clearAllProviderEnv();
    vi.resetModules();
  });

  afterEach(() => {
    Object.assign(process.env, envBackup);
  });

  it('reports not configured when no key', async () => {
    const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
    expect(openrouterBackend.isConfigured()).toBe(false);
  });

  it('reports configured when OPENROUTER_API_KEY is set', async () => {
    setEnv({ OPENROUTER_API_KEY: 'sk-or-test' });
    const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
    expect(openrouterBackend.isConfigured()).toBe(true);
  });

  it('returns correct endpoint', async () => {
    const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
    expect(openrouterBackend.getEndpoint()).toBe('https://openrouter.ai/api/v1');
  });

  it('maps Llama to OpenRouter model ID', async () => {
    const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
    expect(openrouterBackend.resolveModelId('llama-3-70b')).toBe('meta-llama/llama-3-70b-instruct');
  });

  it('passes through unknown models as-is', async () => {
    const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
    expect(openrouterBackend.resolveModelId('some/custom-model')).toBe('some/custom-model');
  });

  it('has chat, embedding, image capabilities', async () => {
    const { openrouterBackend } = await import('@/lib/providers/backends/openrouter');
    expect(openrouterBackend.capabilities).toContain('chat');
    expect(openrouterBackend.capabilities).not.toContain('sfx');
  });
});

describe('githubModelsBackend', () => {
  beforeEach(() => {
    clearAllProviderEnv();
    vi.resetModules();
  });

  afterEach(() => {
    Object.assign(process.env, envBackup);
  });

  it('reports not configured when no PAT', async () => {
    const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
    expect(githubModelsBackend.isConfigured()).toBe(false);
  });

  it('reports configured when GITHUB_MODELS_PAT is set', async () => {
    setEnv({ GITHUB_MODELS_PAT: 'ghp_test' });
    const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
    expect(githubModelsBackend.isConfigured()).toBe(true);
  });

  it('returns correct endpoint', async () => {
    const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
    expect(githubModelsBackend.getEndpoint()).toBe('https://models.inference.ai.azure.com');
  });

  it('maps canonical model names to GitHub deployment names', async () => {
    const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
    expect(githubModelsBackend.resolveModelId('gpt-4o-mini')).toBe('gpt-4o-mini');
    expect(githubModelsBackend.resolveModelId('llama-3-70b')).toBe('Meta-Llama-3-70B-Instruct');
    expect(githubModelsBackend.resolveModelId('mistral-large')).toBe('Mistral-large');
  });

  it('has only chat and embedding capabilities', async () => {
    const { githubModelsBackend } = await import('@/lib/providers/backends/githubModels');
    expect(githubModelsBackend.capabilities).toContain('chat');
    expect(githubModelsBackend.capabilities).toContain('embedding');
    expect(githubModelsBackend.capabilities).not.toContain('image');
    expect(githubModelsBackend.capabilities).not.toContain('model3d');
  });
});

describe('directBackend', () => {
  beforeEach(() => {
    clearAllProviderEnv();
    vi.resetModules();
  });

  afterEach(() => {
    Object.assign(process.env, envBackup);
  });

  it('reports not configured when no platform keys', async () => {
    const { directBackend } = await import('@/lib/providers/backends/direct');
    expect(directBackend.isConfigured()).toBe(false);
  });

  it('reports configured when any platform key is set', async () => {
    setEnv({ PLATFORM_MESHY_KEY: 'meshy-test' });
    const { directBackend } = await import('@/lib/providers/backends/direct');
    expect(directBackend.isConfigured()).toBe(true);
  });

  it('has all capabilities', async () => {
    const { directBackend } = await import('@/lib/providers/backends/direct');
    const allCaps = ['chat', 'embedding', 'image', 'model3d', 'texture', 'sfx', 'voice', 'music', 'sprite', 'bg_removal'];
    for (const cap of allCaps) {
      expect(directBackend.capabilities).toContain(cap);
    }
  });

  it('getDirectProviderKey returns null for unknown provider', async () => {
    const { getDirectProviderKey } = await import('@/lib/providers/backends/direct');
    expect(getDirectProviderKey('unknown-provider')).toBeNull();
  });

  it('getDirectProviderKey returns key for known provider', async () => {
    setEnv({ PLATFORM_MESHY_KEY: 'meshy-123' });
    const { getDirectProviderKey } = await import('@/lib/providers/backends/direct');
    expect(getDirectProviderKey('meshy')).toBe('meshy-123');
  });

  it('getDirectProviderKey returns null when env var not set', async () => {
    const { getDirectProviderKey } = await import('@/lib/providers/backends/direct');
    expect(getDirectProviderKey('anthropic')).toBeNull();
  });

  it('isDirectProviderConfigured returns true when key set', async () => {
    setEnv({ PLATFORM_ELEVENLABS_KEY: 'el-test' });
    const { isDirectProviderConfigured } = await import('@/lib/providers/backends/direct');
    expect(isDirectProviderConfigured('elevenlabs')).toBe(true);
  });

  it('isDirectProviderConfigured returns false when key not set', async () => {
    const { isDirectProviderConfigured } = await import('@/lib/providers/backends/direct');
    expect(isDirectProviderConfigured('elevenlabs')).toBe(false);
  });

  it('passes through model IDs unchanged', async () => {
    const { directBackend } = await import('@/lib/providers/backends/direct');
    expect(directBackend.resolveModelId('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });
});

describe('registry — resolveBackend', () => {
  beforeEach(() => {
    clearAllProviderEnv();
    vi.resetModules();
  });

  afterEach(() => {
    Object.assign(process.env, envBackup);
  });

  it('returns null when no backend is configured', async () => {
    const { resolveBackend } = await import('@/lib/providers/registry');
    expect(resolveBackend('chat')).toBeNull();
  });

  it('returns null when no backend supports the capability', async () => {
    // GitHub Models only does chat + embedding, not model3d
    setEnv({ GITHUB_MODELS_PAT: 'ghp_test' });
    const { resolveBackend } = await import('@/lib/providers/registry');
    expect(resolveBackend('model3d')).toBeNull();
  });

  it('resolves Vercel gateway first when configured', async () => {
    setEnv({
      AI_GATEWAY_API_KEY: 'gw-key',
      OPENROUTER_API_KEY: 'or-key',
      GITHUB_MODELS_PAT: 'ghp_test',
    });
    const { resolveBackend } = await import('@/lib/providers/registry');
    const route = resolveBackend('chat');
    expect(route).not.toBeNull();
    expect(route!.backendId).toBe('vercel-gateway');
  });

  it('falls through to OpenRouter when Vercel not configured', async () => {
    setEnv({
      OPENROUTER_API_KEY: 'or-key',
      GITHUB_MODELS_PAT: 'ghp_test',
    });
    const { resolveBackend } = await import('@/lib/providers/registry');
    const route = resolveBackend('chat');
    expect(route).not.toBeNull();
    expect(route!.backendId).toBe('openrouter');
  });

  it('falls through to GitHub Models when Vercel and OpenRouter not configured', async () => {
    setEnv({ GITHUB_MODELS_PAT: 'ghp_test' });
    const { resolveBackend } = await import('@/lib/providers/registry');
    const route = resolveBackend('chat');
    expect(route).not.toBeNull();
    expect(route!.backendId).toBe('github-models');
  });

  it('falls through to direct for model3d even when gateways are configured', async () => {
    setEnv({
      AI_GATEWAY_API_KEY: 'gw-key',
      PLATFORM_MESHY_KEY: 'meshy-key',
    });
    const { resolveBackend } = await import('@/lib/providers/registry');
    const route = resolveBackend('model3d');
    expect(route).not.toBeNull();
    expect(route!.backendId).toBe('direct');
  });

  it('uses preferred backend when specified and configured', async () => {
    setEnv({
      AI_GATEWAY_API_KEY: 'gw-key',
      OPENROUTER_API_KEY: 'or-key',
    });
    const { resolveBackend } = await import('@/lib/providers/registry');
    const route = resolveBackend('chat', undefined, 'openrouter');
    expect(route).not.toBeNull();
    expect(route!.backendId).toBe('openrouter');
  });

  it('falls back to priority order if preferred backend not configured', async () => {
    setEnv({ OPENROUTER_API_KEY: 'or-key' });
    const { resolveBackend } = await import('@/lib/providers/registry');
    // Prefer Vercel, but it is not configured
    const route = resolveBackend('chat', undefined, 'vercel-gateway');
    expect(route).not.toBeNull();
    expect(route!.backendId).toBe('openrouter');
  });

  it('includes resolved model ID when preferredModel is supplied', async () => {
    setEnv({ AI_GATEWAY_API_KEY: 'gw-key' });
    const { resolveBackend } = await import('@/lib/providers/registry');
    const route = resolveBackend('chat', 'claude-sonnet-4-6');
    expect(route).not.toBeNull();
    expect(route!.modelId).toBe('anthropic/claude-sonnet-4-6');
  });

  it('sets metered=true on resolved route', async () => {
    setEnv({ AI_GATEWAY_API_KEY: 'gw-key' });
    const { resolveBackend } = await import('@/lib/providers/registry');
    const route = resolveBackend('chat');
    expect(route!.metered).toBe(true);
  });

  it('includes endpoint in resolved route', async () => {
    setEnv({ AI_GATEWAY_API_KEY: 'gw-key' });
    const { resolveBackend } = await import('@/lib/providers/registry');
    const route = resolveBackend('chat');
    expect(route!.endpoint).toBe('https://ai-gateway.vercel.sh/v1');
  });

  it('does not include endpoint for direct backend (empty string → undefined)', async () => {
    setEnv({ PLATFORM_MESHY_KEY: 'meshy-key' });
    const { resolveBackend } = await import('@/lib/providers/registry');
    const route = resolveBackend('model3d');
    expect(route!.endpoint).toBeUndefined();
  });
});

describe('registry — capability helpers', () => {
  beforeEach(() => {
    clearAllProviderEnv();
    vi.resetModules();
  });

  afterEach(() => {
    Object.assign(process.env, envBackup);
  });

  it('getAvailableCapabilities returns empty set when nothing configured', async () => {
    const { getAvailableCapabilities } = await import('@/lib/providers/registry');
    expect(getAvailableCapabilities().size).toBe(0);
  });

  it('getAvailableCapabilities returns only capabilities of configured backends', async () => {
    setEnv({ GITHUB_MODELS_PAT: 'ghp_test' });
    const { getAvailableCapabilities } = await import('@/lib/providers/registry');
    const caps = getAvailableCapabilities();
    expect(caps.has('chat')).toBe(true);
    expect(caps.has('embedding')).toBe(true);
    expect(caps.has('model3d')).toBe(false);
  });

  it('getAvailableCapabilities returns all capabilities when direct is configured', async () => {
    setEnv({ PLATFORM_MESHY_KEY: 'meshy-key' });
    const { getAvailableCapabilities } = await import('@/lib/providers/registry');
    const caps = getAvailableCapabilities();
    expect(caps.has('model3d')).toBe(true);
    expect(caps.has('sfx')).toBe(true);
    expect(caps.has('music')).toBe(true);
  });

  it('isCapabilityAvailable returns false when nothing configured', async () => {
    const { isCapabilityAvailable } = await import('@/lib/providers/registry');
    expect(isCapabilityAvailable('chat')).toBe(false);
  });

  it('isCapabilityAvailable returns true when a backend supports it', async () => {
    setEnv({ AI_GATEWAY_API_KEY: 'gw-key' });
    const { isCapabilityAvailable } = await import('@/lib/providers/registry');
    expect(isCapabilityAvailable('chat')).toBe(true);
    expect(isCapabilityAvailable('model3d')).toBe(false);
  });

  it('getAllBackends returns all 4 backends regardless of config', async () => {
    const { getAllBackends } = await import('@/lib/providers/registry');
    const backends = getAllBackends();
    expect(backends).toHaveLength(4);
    const ids = backends.map((b) => b.backend.id);
    expect(ids).toContain('vercel-gateway');
    expect(ids).toContain('openrouter');
    expect(ids).toContain('github-models');
    expect(ids).toContain('direct');
  });

  it('getAllBackends marks configured status correctly', async () => {
    setEnv({ OPENROUTER_API_KEY: 'or-key' });
    const { getAllBackends } = await import('@/lib/providers/registry');
    const backends = getAllBackends();
    const orEntry = backends.find((b) => b.backend.id === 'openrouter');
    const gwEntry = backends.find((b) => b.backend.id === 'vercel-gateway');
    expect(orEntry!.configured).toBe(true);
    expect(gwEntry!.configured).toBe(false);
  });

  it('getConfiguredBackends returns only configured backends', async () => {
    setEnv({ OPENROUTER_API_KEY: 'or-key', PLATFORM_SUNO_KEY: 'suno-key' });
    const { getConfiguredBackends } = await import('@/lib/providers/registry');
    const configured = getConfiguredBackends();
    expect(configured).toHaveLength(2);
    const ids = configured.map((b) => b.id);
    expect(ids).toContain('openrouter');
    expect(ids).toContain('direct');
  });

  it('getConfiguredBackends returns empty array when nothing configured', async () => {
    const { getConfiguredBackends } = await import('@/lib/providers/registry');
    expect(getConfiguredBackends()).toHaveLength(0);
  });
});
