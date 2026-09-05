import { NextRequest } from 'next/server';
/**
 * Tests for GET /api/capabilities
 *
 * Covers: response format, capability availability based on env vars,
 * hints for unconfigured capabilities, gateway/router fallbacks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CapabilitiesResponse } from '../route';

// The route is BYOK-aware since #9117: it consults Clerk and the key
// resolver. These tests cover the anonymous, env-var-only surface, so both
// are stubbed to "no user"; availability.test.ts covers the BYOK branch.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/safe-auth', () => ({
  safeAuth: vi.fn(async () => ({ userId: null })),
}));
vi.mock('@/lib/keys/resolver', () => ({
  listConfiguredProviders: vi.fn(async () => []),
}));
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

describe('GET /api/capabilities', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    // Clear all provider env vars
    vi.unstubAllEnvs();

    const mod = await import('../route');
    GET = mod.GET;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ---------------------------------------------------------------------------
  // Response format
  // ---------------------------------------------------------------------------
  describe('response format', () => {
    it('returns 200 status', async () => {
      const res = await GET(new NextRequest('http://localhost/api/capabilities'));
      expect(res.status).toBe(200);
    });

    it('returns JSON with capabilities array', async () => {
      const res = await GET(new NextRequest('http://localhost/api/capabilities'));
      const body: CapabilitiesResponse = await res.json();
      expect(Array.isArray(body.capabilities)).toBe(true);
      expect(Array.isArray(body.available)).toBe(true);
      expect(Array.isArray(body.unavailable)).toBe(true);
    });

    it('returns all 10 capabilities', async () => {
      const res = await GET(new NextRequest('http://localhost/api/capabilities'));
      const body: CapabilitiesResponse = await res.json();
      expect(body.capabilities).toHaveLength(10);
    });

    it('includes capability, available, and label fields', async () => {
      const res = await GET(new NextRequest('http://localhost/api/capabilities'));
      const body: CapabilitiesResponse = await res.json();
      for (const cap of body.capabilities) {
        expect(cap).toHaveProperty('capability');
        expect(cap).toHaveProperty('available');
        expect(cap).toHaveProperty('label');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // No keys configured
  // ---------------------------------------------------------------------------
  describe('no keys configured', () => {
    it('marks all capabilities as unavailable', async () => {
      const res = await GET(new NextRequest('http://localhost/api/capabilities'));
      const body: CapabilitiesResponse = await res.json();
      expect(body.available).toHaveLength(0);
      expect(body.unavailable).toHaveLength(10);
    });

    it('includes hints for unavailable capabilities', async () => {
      const res = await GET(new NextRequest('http://localhost/api/capabilities'));
      const body: CapabilitiesResponse = await res.json();
      for (const cap of body.capabilities) {
        expect(cap.hint).toBeDefined();
        if (cap.unprovisionable) {
          // No key can help; the hint names the tracking issue instead (#9117).
          expect(cap.hint).toMatch(/#\d+/);
          expect(cap.requiredProviders).toBeUndefined();
          continue;
        }
        expect(cap.hint).toContain('Settings');
        expect(cap.requiredProviders).toBeDefined();
        expect(cap.requiredProviders!.length).toBeGreaterThan(0);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Direct provider keys
  // ---------------------------------------------------------------------------
  describe('direct provider keys', () => {
    it('marks chat as available when ANTHROPIC_API_KEY is set', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test-key');
      vi.resetModules();
      const mod = await import('../route');
      const res = await mod.GET(new NextRequest('http://localhost/api/capabilities'));
      const body: CapabilitiesResponse = await res.json();

      const chat = body.capabilities.find((c) => c.capability === 'chat');
      expect(chat?.available).toBe(true);
      expect(body.available).toContain('chat');
    });

    it('marks model3d and texture as available when PLATFORM_MESHY_KEY is set', async () => {
      vi.stubEnv('PLATFORM_MESHY_KEY', 'msh-test-key');
      vi.resetModules();
      const mod = await import('../route');
      const res = await mod.GET(new NextRequest('http://localhost/api/capabilities'));
      const body: CapabilitiesResponse = await res.json();

      const model3d = body.capabilities.find((c) => c.capability === 'model3d');
      const texture = body.capabilities.find((c) => c.capability === 'texture');
      expect(model3d?.available).toBe(true);
      expect(texture?.available).toBe(true);
    });

    it('marks sfx and voice as available when PLATFORM_ELEVENLABS_KEY is set', async () => {
      vi.stubEnv('PLATFORM_ELEVENLABS_KEY', 'el-test-key');
      vi.resetModules();
      const mod = await import('../route');
      const res = await mod.GET(new NextRequest('http://localhost/api/capabilities'));
      const body: CapabilitiesResponse = await res.json();

      const sfx = body.capabilities.find((c) => c.capability === 'sfx');
      const voice = body.capabilities.find((c) => c.capability === 'voice');
      expect(sfx?.available).toBe(true);
      expect(voice?.available).toBe(true);
    });

    it('keeps music unavailable even when PLATFORM_SUNO_KEY is set (#9522: Suno has no API)', async () => {
      vi.stubEnv('PLATFORM_SUNO_KEY', 'suno-test');
      vi.resetModules();
      const mod = await import('../route');
      const res = await mod.GET(new NextRequest('http://localhost/api/capabilities'));
      const body: CapabilitiesResponse = await res.json();

      const music = body.capabilities.find((c) => c.capability === 'music');
      expect(music?.available).toBe(false);
      expect(music?.unprovisionable).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Gateway / router fallbacks
  // ---------------------------------------------------------------------------
  describe('gateway and router fallbacks', () => {
    it('marks chat as available via OPENROUTER_API_KEY', async () => {
      vi.stubEnv('OPENROUTER_API_KEY', 'or-test');
      vi.resetModules();
      const mod = await import('../route');
      const res = await mod.GET(new NextRequest('http://localhost/api/capabilities'));
      const body: CapabilitiesResponse = await res.json();

      const chat = body.capabilities.find((c) => c.capability === 'chat');
      expect(chat?.available).toBe(true);
    });

    it('marks chat as available via AI_GATEWAY_API_KEY', async () => {
      vi.stubEnv('AI_GATEWAY_API_KEY', 'gw-test');
      vi.resetModules();
      const mod = await import('../route');
      const res = await mod.GET(new NextRequest('http://localhost/api/capabilities'));
      const body: CapabilitiesResponse = await res.json();

      const chat = body.capabilities.find((c) => c.capability === 'chat');
      expect(chat?.available).toBe(true);
    });

    it('marks chat and embedding available via GITHUB_MODELS_PAT', async () => {
      vi.stubEnv('GITHUB_MODELS_PAT', 'ghp-test');
      vi.resetModules();
      const mod = await import('../route');
      const res = await mod.GET(new NextRequest('http://localhost/api/capabilities'));
      const body: CapabilitiesResponse = await res.json();

      const chat = body.capabilities.find((c) => c.capability === 'chat');
      const embedding = body.capabilities.find((c) => c.capability === 'embedding');
      expect(chat?.available).toBe(true);
      expect(embedding?.available).toBe(true);
    });

    it('model3d is NOT available via gateways (direct only)', async () => {
      vi.stubEnv('OPENROUTER_API_KEY', 'or-test');
      vi.stubEnv('AI_GATEWAY_API_KEY', 'gw-test');
      vi.resetModules();
      const mod = await import('../route');
      const res = await mod.GET(new NextRequest('http://localhost/api/capabilities'));
      const body: CapabilitiesResponse = await res.json();

      const model3d = body.capabilities.find((c) => c.capability === 'model3d');
      expect(model3d?.available).toBe(false);
      expect(model3d?.hint).toContain('Meshy');
    });
  });

  // ---------------------------------------------------------------------------
  // Hints content
  // ---------------------------------------------------------------------------
  describe('hints', () => {
    it('includes provider name in the hint', async () => {
      const res = await GET(new NextRequest('http://localhost/api/capabilities'));
      const body: CapabilitiesResponse = await res.json();

      const model3d = body.capabilities.find((c) => c.capability === 'model3d');
      expect(model3d?.hint).toContain('Meshy');

      const sfx = body.capabilities.find((c) => c.capability === 'sfx');
      expect(sfx?.hint).toContain('ElevenLabs');

      // Unprovisionable: the hint names the tracking issue, not a vendor (#9117).
      const music = body.capabilities.find((c) => c.capability === 'music');
      expect(music?.hint).toContain('#9522');
    });

    it('does not include hint for available capabilities', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
      vi.resetModules();
      const mod = await import('../route');
      const res = await mod.GET(new NextRequest('http://localhost/api/capabilities'));
      const body: CapabilitiesResponse = await res.json();

      const chat = body.capabilities.find((c) => c.capability === 'chat');
      expect(chat?.hint).toBeUndefined();
      expect(chat?.requiredProviders).toBeUndefined();
    });
  });
});
