/**
 * Tests for the direct provider backend.
 *
 * Covers: configuration detection, API key resolution per provider/capability,
 * model passthrough, and negative cases (missing keys, unknown providers).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const envBackup = { ...process.env };

function clearDirectEnv(): void {
  const keys = [
    'ANTHROPIC_API_KEY',
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

describe('directBackend', () => {
  beforeEach(() => {
    vi.resetModules();
    clearDirectEnv();
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  describe('isConfigured', () => {
    it('returns false when no platform keys are set', async () => {
      const { directBackend } = await import('@/lib/providers/backends/direct');
      expect(directBackend.isConfigured()).toBe(false);
    });

    it('returns true when only ANTHROPIC_API_KEY is set', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      const { directBackend } = await import('@/lib/providers/backends/direct');
      expect(directBackend.isConfigured()).toBe(true);
    });

    it('returns true when only PLATFORM_MESHY_KEY is set', async () => {
      process.env.PLATFORM_MESHY_KEY = 'meshy-test';
      const { directBackend } = await import('@/lib/providers/backends/direct');
      expect(directBackend.isConfigured()).toBe(true);
    });

    it('returns true when only PLATFORM_REMOVEBG_KEY is set', async () => {
      process.env.PLATFORM_REMOVEBG_KEY = 'rbg-test';
      const { directBackend } = await import('@/lib/providers/backends/direct');
      expect(directBackend.isConfigured()).toBe(true);
    });

    it('returns true when multiple platform keys are set', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      process.env.PLATFORM_OPENAI_KEY = 'sk-oai-test';
      const { directBackend } = await import('@/lib/providers/backends/direct');
      expect(directBackend.isConfigured()).toBe(true);
    });
  });

  describe('getApiKey', () => {
    it('returns Anthropic key as primary key', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-primary';
      const { directBackend } = await import('@/lib/providers/backends/direct');
      expect(directBackend.getApiKey()).toBe('sk-ant-primary');
    });

    it('returns empty string when Anthropic key is not set', async () => {
      process.env.PLATFORM_MESHY_KEY = 'meshy-test';
      const { directBackend } = await import('@/lib/providers/backends/direct');
      expect(directBackend.getApiKey()).toBe('');
    });
  });

  describe('getEndpoint', () => {
    it('returns empty string (direct calls go to native endpoints)', async () => {
      const { directBackend } = await import('@/lib/providers/backends/direct');
      expect(directBackend.getEndpoint()).toBe('');
    });
  });

  describe('resolveModelId', () => {
    it('passes through model IDs unchanged', async () => {
      const { directBackend } = await import('@/lib/providers/backends/direct');
      expect(directBackend.resolveModelId('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
      expect(directBackend.resolveModelId('gpt-4o')).toBe('gpt-4o');
      expect(directBackend.resolveModelId('custom/model')).toBe('custom/model');
    });

    it('passes through empty string', async () => {
      const { directBackend } = await import('@/lib/providers/backends/direct');
      expect(directBackend.resolveModelId('')).toBe('');
    });
  });

  describe('capabilities', () => {
    it('includes all 10 capabilities', async () => {
      const { directBackend } = await import('@/lib/providers/backends/direct');
      const expected = [
        'chat', 'embedding', 'image', 'model3d', 'texture',
        'sfx', 'voice', 'music', 'sprite', 'bg_removal',
      ];
      for (const cap of expected) {
        expect(directBackend.capabilities).toContain(cap);
      }
      expect(directBackend.capabilities).toHaveLength(10);
    });
  });

  describe('metadata', () => {
    it('has correct id and name', async () => {
      const { directBackend } = await import('@/lib/providers/backends/direct');
      expect(directBackend.id).toBe('direct');
      expect(directBackend.name).toBe('Direct (Platform Keys)');
    });
  });
});

describe('getDirectProviderKey', () => {
  beforeEach(() => {
    clearDirectEnv();
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('returns key for anthropic when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-123';
    const { getDirectProviderKey } = await import('@/lib/providers/backends/direct');
    expect(getDirectProviderKey('anthropic')).toBe('sk-ant-123');
  });

  it('returns key for openai when PLATFORM_OPENAI_KEY is set', async () => {
    process.env.PLATFORM_OPENAI_KEY = 'sk-oai-456';
    const { getDirectProviderKey } = await import('@/lib/providers/backends/direct');
    expect(getDirectProviderKey('openai')).toBe('sk-oai-456');
  });

  it('returns key for meshy when PLATFORM_MESHY_KEY is set', async () => {
    process.env.PLATFORM_MESHY_KEY = 'meshy-789';
    const { getDirectProviderKey } = await import('@/lib/providers/backends/direct');
    expect(getDirectProviderKey('meshy')).toBe('meshy-789');
  });

  it('returns key for hyper3d when PLATFORM_HYPER3D_KEY is set', async () => {
    process.env.PLATFORM_HYPER3D_KEY = 'h3d-test';
    const { getDirectProviderKey } = await import('@/lib/providers/backends/direct');
    expect(getDirectProviderKey('hyper3d')).toBe('h3d-test');
  });

  it('returns key for elevenlabs when PLATFORM_ELEVENLABS_KEY is set', async () => {
    process.env.PLATFORM_ELEVENLABS_KEY = 'el-test';
    const { getDirectProviderKey } = await import('@/lib/providers/backends/direct');
    expect(getDirectProviderKey('elevenlabs')).toBe('el-test');
  });

  it('returns key for suno when PLATFORM_SUNO_KEY is set', async () => {
    process.env.PLATFORM_SUNO_KEY = 'suno-test';
    const { getDirectProviderKey } = await import('@/lib/providers/backends/direct');
    expect(getDirectProviderKey('suno')).toBe('suno-test');
  });

  it('returns key for replicate when PLATFORM_REPLICATE_KEY is set', async () => {
    process.env.PLATFORM_REPLICATE_KEY = 'rep-test';
    const { getDirectProviderKey } = await import('@/lib/providers/backends/direct');
    expect(getDirectProviderKey('replicate')).toBe('rep-test');
  });

  it('returns key for removebg when PLATFORM_REMOVEBG_KEY is set', async () => {
    process.env.PLATFORM_REMOVEBG_KEY = 'rbg-test';
    const { getDirectProviderKey } = await import('@/lib/providers/backends/direct');
    expect(getDirectProviderKey('removebg')).toBe('rbg-test');
  });

  it('returns null for unknown provider name', async () => {
    const { getDirectProviderKey } = await import('@/lib/providers/backends/direct');
    expect(getDirectProviderKey('unknown-provider')).toBeNull();
  });

  it('returns null for empty string provider', async () => {
    const { getDirectProviderKey } = await import('@/lib/providers/backends/direct');
    expect(getDirectProviderKey('')).toBeNull();
  });

  it('returns null when known provider key is not set in env', async () => {
    const { getDirectProviderKey } = await import('@/lib/providers/backends/direct');
    expect(getDirectProviderKey('anthropic')).toBeNull();
    expect(getDirectProviderKey('meshy')).toBeNull();
  });
});

describe('isDirectProviderConfigured', () => {
  beforeEach(() => {
    clearDirectEnv();
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('returns true when provider key is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const { isDirectProviderConfigured } = await import('@/lib/providers/backends/direct');
    expect(isDirectProviderConfigured('anthropic')).toBe(true);
  });

  it('returns false when provider key is not set', async () => {
    const { isDirectProviderConfigured } = await import('@/lib/providers/backends/direct');
    expect(isDirectProviderConfigured('anthropic')).toBe(false);
  });

  it('returns false for unknown provider', async () => {
    const { isDirectProviderConfigured } = await import('@/lib/providers/backends/direct');
    expect(isDirectProviderConfigured('nonexistent')).toBe(false);
  });
});

describe('resolveDirectKey', () => {
  beforeEach(() => {
    clearDirectEnv();
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('resolves chat capability to ANTHROPIC_API_KEY', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-chat';
    const { resolveDirectKey } = await import('@/lib/providers/backends/direct');
    expect(resolveDirectKey('chat')).toBe('sk-chat');
  });

  it('resolves embedding capability to PLATFORM_OPENAI_KEY', async () => {
    process.env.PLATFORM_OPENAI_KEY = 'sk-embed';
    const { resolveDirectKey } = await import('@/lib/providers/backends/direct');
    expect(resolveDirectKey('embedding')).toBe('sk-embed');
  });

  it('resolves image capability to PLATFORM_OPENAI_KEY', async () => {
    process.env.PLATFORM_OPENAI_KEY = 'sk-img';
    const { resolveDirectKey } = await import('@/lib/providers/backends/direct');
    expect(resolveDirectKey('image')).toBe('sk-img');
  });

  it('resolves model3d capability to PLATFORM_MESHY_KEY', async () => {
    process.env.PLATFORM_MESHY_KEY = 'meshy-3d';
    const { resolveDirectKey } = await import('@/lib/providers/backends/direct');
    expect(resolveDirectKey('model3d')).toBe('meshy-3d');
  });

  it('resolves texture capability to PLATFORM_MESHY_KEY', async () => {
    process.env.PLATFORM_MESHY_KEY = 'meshy-tex';
    const { resolveDirectKey } = await import('@/lib/providers/backends/direct');
    expect(resolveDirectKey('texture')).toBe('meshy-tex');
  });

  it('resolves sfx capability to PLATFORM_ELEVENLABS_KEY', async () => {
    process.env.PLATFORM_ELEVENLABS_KEY = 'el-sfx';
    const { resolveDirectKey } = await import('@/lib/providers/backends/direct');
    expect(resolveDirectKey('sfx')).toBe('el-sfx');
  });

  it('resolves voice capability to PLATFORM_ELEVENLABS_KEY', async () => {
    process.env.PLATFORM_ELEVENLABS_KEY = 'el-voice';
    const { resolveDirectKey } = await import('@/lib/providers/backends/direct');
    expect(resolveDirectKey('voice')).toBe('el-voice');
  });

  it('resolves music capability to PLATFORM_SUNO_KEY', async () => {
    process.env.PLATFORM_SUNO_KEY = 'suno-music';
    const { resolveDirectKey } = await import('@/lib/providers/backends/direct');
    expect(resolveDirectKey('music')).toBe('suno-music');
  });

  it('resolves sprite capability to PLATFORM_REPLICATE_KEY', async () => {
    process.env.PLATFORM_REPLICATE_KEY = 'rep-sprite';
    const { resolveDirectKey } = await import('@/lib/providers/backends/direct');
    expect(resolveDirectKey('sprite')).toBe('rep-sprite');
  });

  it('resolves bg_removal capability to PLATFORM_REMOVEBG_KEY', async () => {
    process.env.PLATFORM_REMOVEBG_KEY = 'rbg-key';
    const { resolveDirectKey } = await import('@/lib/providers/backends/direct');
    expect(resolveDirectKey('bg_removal')).toBe('rbg-key');
  });

  it('returns empty string when capability key is not set', async () => {
    const { resolveDirectKey } = await import('@/lib/providers/backends/direct');
    expect(resolveDirectKey('chat')).toBe('');
    expect(resolveDirectKey('model3d')).toBe('');
  });
});
