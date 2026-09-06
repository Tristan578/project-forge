/**
 * Tests for the platform-generation verification script (#9117).
 *
 * The script answers one question per capability: "with the keys in THIS
 * environment, would a platform-key generation request be accepted by the
 * provider?" It decides the route from `lib/config/providers.ts` and, for
 * every configured provider, performs one cheap authenticated request that
 * costs no credits. The request shapes below are pinned to each provider's
 * documented account/auth endpoint (URLs in the script), per lesson 14: a
 * mocked transport pins whatever contract we believed, so the contract must
 * be the vendor's, cited.
 */

// @vitest-environment node

import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildPlan,
  runVerification,
  formatTable,
  summarize,
  isMainModule,
  PROVIDER_PROBES,
  GATEWAY_PROBE,
  type PlanRow,
  type ProbeResult,
} from '../verify-platform-generation.ts';

/** First row per capability (sprite has two - see the dedicated test). */
function rows(env: Record<string, string | undefined>): Record<string, PlanRow> {
  const out: Record<string, PlanRow> = {};
  for (const r of buildPlan(env)) out[r.capability] ??= r;
  return out;
}

describe('buildPlan', () => {
  it('lists every capability, with one extra row for each additional key sprite needs', () => {
    const plan = buildPlan({});
    const caps = plan.map((r) => r.capability);
    // sprite appears twice (Replicate + OpenAI); everything else once.
    expect(caps.filter((c) => c === 'sprite')).toHaveLength(2);
    expect(new Set(caps).size).toBe(caps.length - 1);
    expect(caps).toEqual(
      expect.arrayContaining(['chat', 'image', 'model3d', 'texture', 'sfx', 'voice', 'music', 'sprite', 'bg_removal', 'embedding']),
    );
  });

  it('routes music as unavailable regardless of keys', () => {
    const r = rows({ PLATFORM_SUNO_KEY: 'x' });
    expect(r.music.route).toBe('unavailable');
    expect(r.music.configured).toBe(false);
    expect(r.music.detail).toContain('#9522');
  });

  it('routes chat through the gateway when AI_GATEWAY_API_KEY is set', () => {
    const r = rows({ AI_GATEWAY_API_KEY: 'gw' });
    expect(r.chat.route).toBe('gateway');
    expect(r.chat.configured).toBe(true);
    expect(r.chat.envVar).toBe('AI_GATEWAY_API_KEY');
  });

  it('routes exactly the gateway-declared capabilities through the gateway key', () => {
    const r = rows({ AI_GATEWAY_API_KEY: 'gw' });
    // Same list the vercel-gateway backend declares (GATEWAY_CAPABILITIES).
    for (const cap of ['chat', 'embedding', 'image']) {
      expect(r[cap].route, cap).toBe('gateway');
      expect(r[cap].configured, cap).toBe(true);
    }
    for (const cap of ['model3d', 'texture', 'sfx', 'voice', 'sprite', 'bg_removal']) {
      expect(r[cap].route, cap).toBe('platform-key');
      expect(r[cap].configured, cap).toBe(false);
    }
  });

  it('reports a gateway-served capability as missing AI_GATEWAY_API_KEY rather than falling back to a direct key', () => {
    const r = rows({ ANTHROPIC_API_KEY: 'sk-ant', PLATFORM_OPENAI_KEY: 'sk' });
    for (const cap of ['chat', 'embedding', 'image']) {
      expect(r[cap].route, cap).toBe('gateway');
      expect(r[cap].configured, cap).toBe(false);
      expect(r[cap].envVar, cap).toBe('AI_GATEWAY_API_KEY');
    }
  });

  it('requires BOTH Replicate and OpenAI for sprite (the default sprite path is DALL-E 3)', () => {
    const spriteRows = buildPlan({ PLATFORM_REPLICATE_KEY: 'r8' }).filter((r) => r.capability === 'sprite');
    expect(spriteRows.map((r) => r.provider).sort()).toEqual(['openai', 'replicate']);
    expect(spriteRows.find((r) => r.provider === 'replicate')?.configured).toBe(true);
    expect(spriteRows.find((r) => r.provider === 'openai')?.configured).toBe(false);
  });

  it('marks a platform-key capability configured when its provider key is present', () => {
    const r = rows({ PLATFORM_MESHY_KEY: 'msy_x' });
    expect(r.model3d.configured).toBe(true);
    expect(r.model3d.envVar).toBe('PLATFORM_MESHY_KEY');
    expect(r.texture.configured).toBe(true);
    expect(r.sfx.configured).toBe(false);
    expect(r.sfx.envVar).toBe('PLATFORM_ELEVENLABS_KEY');
  });
});

describe('PROVIDER_PROBES', () => {
  it('names a documented, credit-free endpoint for every probeable provider', () => {
    for (const [provider, probe] of Object.entries(PROVIDER_PROBES)) {
      if (probe === null) continue;
      expect(probe.url, provider).toMatch(/^https:\/\//);
      expect(probe.docs, provider).toMatch(/^https:\/\//);
      expect(probe.method).toBe('GET');
    }
  });

  // Each vendor's documented auth header and account endpoint, pinned
  // verbatim (lesson 14). The doc URL for each is in PROVIDER_PROBES.
  it.each([
    ['anthropic', 'https://api.anthropic.com/v1/models', { 'x-api-key': 'K', 'anthropic-version': '2023-06-01' }],
    ['meshy', 'https://api.meshy.ai/openapi/v1/balance', { Authorization: 'Bearer K' }],
    ['elevenlabs', 'https://api.elevenlabs.io/v1/user', { 'xi-api-key': 'K' }],
    ['openai', 'https://api.openai.com/v1/models', { Authorization: 'Bearer K' }],
    ['replicate', 'https://api.replicate.com/v1/account', { Authorization: 'Bearer K' }],
    ['removebg', 'https://api.remove.bg/v1.0/account', { 'X-Api-Key': 'K' }],
  ] as const)('%s probes %s with its documented auth header', (provider, url, headers) => {
    const probe = PROVIDER_PROBES[provider];
    expect(probe?.url).toBe(url);
    expect(probe?.headers('K')).toEqual(headers);
  });

  it('has no probe for providers that can never be served by a platform key', () => {
    expect(PROVIDER_PROBES.suno).toBeNull();
    expect(PROVIDER_PROBES.hyper3d).toBeNull();
  });

  it('probes the gateway credits endpoint with Bearer auth', () => {
    expect(GATEWAY_PROBE.url).toBe('https://ai-gateway.vercel.sh/v1/credits');
    expect(GATEWAY_PROBE.headers('K')).toEqual({ Authorization: 'Bearer K' });
  });
});

describe('isMainModule', () => {
  it('is false without an argv[1] and true when argv[1] resolves to the module URL', () => {
    expect(isMainModule('file:///x.ts', undefined)).toBe(false);
    const here = path.resolve('scripts/verify-platform-generation.ts');
    expect(isMainModule(pathToFileURL(here).href, here)).toBe(true);
    expect(isMainModule(pathToFileURL(here).href, path.resolve('scripts/other.ts'))).toBe(false);
  });
});

describe('runVerification', () => {
  const okFetch = () =>
    vi.fn(async () => new Response('{}', { status: 200 }));

  it('sends one authenticated request per configured provider using its documented header', async () => {
    const fetchImpl = okFetch();
    const results = await runVerification(
      buildPlan({ PLATFORM_MESHY_KEY: 'msy_secret', PLATFORM_ELEVENLABS_KEY: 'xi_secret' }),
      { fetchImpl, env: { PLATFORM_MESHY_KEY: 'msy_secret', PLATFORM_ELEVENLABS_KEY: 'xi_secret' } },
    );
    const byCap = Object.fromEntries(results.map((r) => [r.capability, r]));
    expect(byCap.model3d.status).toBe('pass');
    expect(byCap.texture.status).toBe('pass');
    expect(byCap.sfx.status).toBe('pass');
    expect(byCap.voice.status).toBe('pass');
    // One probe per provider, not per capability.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    // Exact-host match (not a substring): CodeQL's incomplete-URL-sanitization
    // rule is right that `includes('api.meshy.ai')` would also accept
    // `api.meshy.ai.evil.example`, and a probe test should be as strict as
    // the contract it pins.
    const hostOf = (url: string) => new URL(url).hostname;
    const meshy = calls.find(([url]) => hostOf(url) === 'api.meshy.ai');
    const eleven = calls.find(([url]) => hostOf(url) === 'api.elevenlabs.io');
    // Meshy: https://docs.meshy.ai/en/api/balance — Authorization: Bearer.
    expect(meshy?.[0]).toBe('https://api.meshy.ai/openapi/v1/balance');
    expect((meshy?.[1].headers as Record<string, string>).Authorization).toBe('Bearer msy_secret');
    // ElevenLabs: https://elevenlabs.io/docs/api-reference/user/get — xi-api-key.
    expect(eleven?.[0]).toBe('https://api.elevenlabs.io/v1/user');
    expect((eleven?.[1].headers as Record<string, string>)['xi-api-key']).toBe('xi_secret');
  });

  it('probes the gateway once for chat/embedding/image when only the gateway key is set', async () => {
    const fetchImpl = okFetch();
    const env = { AI_GATEWAY_API_KEY: 'gw_secret' };
    const results = await runVerification(buildPlan(env), { fetchImpl, env });
    const byCap = Object.fromEntries(results.map((r) => [r.capability, r]));
    expect(byCap.chat.status).toBe('pass');
    expect(byCap.embedding.status).toBe('pass');
    expect(byCap.image.status).toBe('pass');
    expect(byCap.model3d.status).toBe('missing');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ai-gateway.vercel.sh/v1/credits');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gw_secret');
  });

  it('reports the OpenAI half of sprite as missing in a Replicate-only environment', async () => {
    const fetchImpl = okFetch();
    const env = { PLATFORM_REPLICATE_KEY: 'r8' };
    const results = await runVerification(buildPlan(env), { fetchImpl, env });
    const sprite = results.filter((r) => r.capability === 'sprite');
    expect(sprite.find((r) => r.provider === 'replicate')?.status).toBe('pass');
    expect(sprite.find((r) => r.provider === 'openai')?.status).toBe('missing');
    expect(sprite.find((r) => r.provider === 'openai')?.detail).toContain('PLATFORM_OPENAI_KEY');
  });

  it('reports fail with the HTTP status when the provider rejects the key', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"unauthorized"}', { status: 401 }));
    const results = await runVerification(buildPlan({ PLATFORM_MESHY_KEY: 'bad' }), {
      fetchImpl,
      env: { PLATFORM_MESHY_KEY: 'bad' },
    });
    const model3d = results.find((r) => r.capability === 'model3d');
    expect(model3d?.status).toBe('fail');
    expect(model3d?.detail).toContain('401');
  });

  it('reports missing without a request when the key is absent, and unavailable for music', async () => {
    const fetchImpl = okFetch();
    const results = await runVerification(buildPlan({}), { fetchImpl, env: {} });
    const byCap = Object.fromEntries(results.map((r) => [r.capability, r]));
    expect(byCap.model3d.status).toBe('missing');
    expect(byCap.music.status).toBe('unavailable');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports fail, never pass, for a configured provider the script has no probe for', async () => {
    const fetchImpl = okFetch();
    const row: PlanRow = {
      capability: 'model3d',
      provider: 'hyper3d',
      route: 'platform-key',
      envVar: 'PLATFORM_HYPER3D_KEY',
      configured: true,
      consoleUrl: null,
      detail: '',
    };
    const [result] = await runVerification([row], { fetchImpl, env: { PLATFORM_HYPER3D_KEY: 'k' } });
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('no credit-free probe');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports fail (not a crash) when the probe throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const results = await runVerification(buildPlan({ PLATFORM_REMOVEBG_KEY: 'k' }), {
      fetchImpl,
      env: { PLATFORM_REMOVEBG_KEY: 'k' },
    });
    const bg = results.find((r) => r.capability === 'bg_removal');
    expect(bg?.status).toBe('fail');
    expect(bg?.detail).toContain('ECONNRESET');
  });
});

// The summary and the exit code used to live inside the `isMainModule` block,
// where nothing could pin them. Three properties the report depends on:
// sprite's two rows are ONE offered capability; one `missing` row keeps a
// capability out of `verified`; and `missing` — not only `fail` — is a
// non-zero exit, because an unset platform key is exactly what the script
// exists to catch.
describe('summarize', () => {
  const row = (capability: ProbeResult['capability'], provider: string, status: ProbeResult['status']): ProbeResult => ({
    capability,
    provider,
    route: status === 'unavailable' ? 'unavailable' : 'platform-key',
    status,
    detail: '',
  });

  it('counts a two-row capability (sprite) once, with both providers verified', () => {
    const summary = summarize([
      row('sprite', 'replicate', 'pass'),
      row('sprite', 'openai', 'pass'),
      row('model3d', 'meshy', 'pass'),
    ]);
    expect(summary).toEqual({ offered: 2, verified: 2, unavailable: 0, failing: 0 });
  });

  it('verifies sprite when one alternative passes and leaves the missing row visible', () => {
    const summary = summarize([
      row('sprite', 'replicate', 'pass'),
      row('sprite', 'openai', 'missing'),
      row('model3d', 'meshy', 'pass'),
    ]);
    expect(summary).toEqual({ offered: 2, verified: 2, unavailable: 0, failing: 0 });
  });

  it('keeps an unavailable capability out of offered, and counts fail and missing as failing', () => {
    const summary = summarize([
      row('music', 'suno', 'unavailable'),
      row('sfx', 'elevenlabs', 'fail'),
      row('voice', 'elevenlabs', 'missing'),
      row('texture', 'meshy', 'pass'),
    ]);
    expect(summary).toEqual({ offered: 3, verified: 1, unavailable: 1, failing: 2 });
  });
});

describe('formatTable', () => {
  it('prints one line per capability with its status', () => {
    const out = formatTable([
      { capability: 'music', provider: 'suno', route: 'unavailable', status: 'unavailable', detail: '#9522' },
      { capability: 'model3d', provider: 'meshy', route: 'platform-key', status: 'pass', detail: '200' },
    ]);
    expect(out).toContain('music');
    expect(out).toContain('unavailable');
    expect(out).toContain('model3d');
    expect(out).toContain('pass');
  });
});
