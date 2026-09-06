/**
 * useGenerationGate — the dialog-facing gate over /api/capabilities (#9117).
 *
 * Successful per-user unavailable responses block; loading and failed fetches
 * do not. BYOK availability is already resolved by the server.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useGenerationGate, combineGenerationGates, type GenerationGateResult } from '../useGenerationGate';
import { _resetCapabilitiesCache } from '../useFeatureGating';
import type { CapabilitiesResponse } from '@/app/api/capabilities/route';

function respond(body: CapabilitiesResponse) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
}

const FIXTURE: CapabilitiesResponse = {
  capabilities: [
    { capability: 'sfx', available: true, label: 'Sound Effect Generation' },
    {
      capability: 'model3d',
      available: false,
      label: '3D Model Generation',
      requiredProviders: ['Meshy'],
      byokConfigurable: true,
      hint: 'Configure Meshy API key in Settings to enable 3D Model Generation.',
    },
    {
      capability: 'sprite',
      available: false,
      label: 'Sprite Generation',
      requiredProviders: ['Replicate', 'OpenAI'],
      byokConfigurable: false,
      hint: 'Sprite Generation needs Replicate and OpenAI API keys, which only this deployment can configure.',
    },
    {
      capability: 'music',
      available: false,
      label: 'Music Generation',
      unprovisionable: true,
      issue: 9522,
      hint: 'Music generation is not available yet. Generate a sound effect instead.',
    },
    { capability: 'texture', available: false, label: 'Texture Generation', unprovisionable: true, issue: 1 },
  ],
  available: ['sfx'],
  unavailable: ['model3d', 'sprite', 'music', 'texture'],
  degraded: false,
};

describe('useGenerationGate', () => {
  beforeEach(() => {
    _resetCapabilitiesCache();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    _resetCapabilitiesCache();
  });

  it('is not blocked while capabilities are loading', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useGenerationGate('music-generation'));
    expect(result.current.loading).toBe(true);
    expect(result.current.blocked).toBe(false);
  });

  it('blocks an unprovisionable feature and surfaces the server hint verbatim', async () => {
    respond(FIXTURE);
    const { result } = renderHook(() => useGenerationGate('music-generation'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.blocked).toBe(true);
    expect(result.current.reason).toBe('Music generation is not available yet. Generate a sound effect instead.');
  });

  it('blocks a feature the server reports unavailable for the current user', async () => {
    respond(FIXTURE);
    const { result } = renderHook(() => useGenerationGate('model-generation'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.blocked).toBe(true);
    expect(result.current.reason).toContain('Meshy');
  });

  it('does not block a feature the server reports available', async () => {
    respond(FIXTURE);
    const { result } = renderHook(() => useGenerationGate('sfx-generation'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.blocked).toBe(false);
  });

  it('derives a reason from the label when the server sends no hint', async () => {
    respond(FIXTURE);
    const { result } = renderHook(() => useGenerationGate('texture-generation'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.blocked).toBe(true);
    expect(result.current.reason).toBe('Texture Generation is not available yet.');
  });

  // The server fails OPEN when it cannot read the caller's BYOK keys, answering
  // 200 with platform-only availability. Blocking on that turned a server
  // fail-open into a client fail-closed: production runs zero PLATFORM_* keys,
  // so one DB blip told every BYOK user to configure the key they already hold
  // and disabled Generate everywhere for the cache TTL (#9725 p7).
  it('does not block a provisionable capability when the body is degraded', async () => {
    respond({ ...FIXTURE, degraded: true });
    const { result } = renderHook(() => useGenerationGate('model-generation'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.blocked).toBe(false);
    expect(result.current.reason).toBeUndefined();
  });

  // `unprovisionable` is decided from a code constant, not from any lookup, so
  // it survives a degraded body: music stays refused.
  it('still blocks an unprovisionable capability when the body is degraded', async () => {
    respond({ ...FIXTURE, degraded: true });
    const { result } = renderHook(() => useGenerationGate('music-generation'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.blocked).toBe(true);
    expect(result.current.unprovisionable).toBe(true);
  });

  // Entry points (Asset panel menu, Audio inspector buttons) hard-disable only
  // on `unprovisionable`; a merely unconfigured capability stays clickable so
  // the in-dialog notice and its Settings link remain reachable (#9725 p7).
  it('reports unprovisionable separately from blocked', async () => {
    respond(FIXTURE);
    const music = renderHook(() => useGenerationGate('music-generation'));
    await waitFor(() => expect(music.result.current.loading).toBe(false));
    expect(music.result.current.unprovisionable).toBe(true);

    const model = renderHook(() => useGenerationGate('model-generation'));
    expect(model.result.current.blocked).toBe(true);
    expect(model.result.current.unprovisionable).toBe(false);

    const sfx = renderHook(() => useGenerationGate('sfx-generation'));
    expect(sfx.result.current.blocked).toBe(false);
    expect(sfx.result.current.unprovisionable).toBe(false);
  });

  it('fails open when the capabilities fetch errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useGenerationGate('music-generation'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.blocked).toBe(false);
  });

  // The notice's "Open Settings" affordance renders from this and nothing
  // else: Settings can only store a BYOK_PROVIDERS key, so sprite (Replicate +
  // OpenAI) must never offer it (#9725 p8).
  it('carries the route’s byokConfigurable through, defaulting to false', async () => {
    respond(FIXTURE);
    const model = renderHook(() => useGenerationGate('model-generation'));
    await waitFor(() => expect(model.result.current.loading).toBe(false));
    expect(model.result.current.byokConfigurable).toBe(true);

    const sprite = renderHook(() => useGenerationGate('sprite-generation'));
    expect(sprite.result.current.blocked).toBe(true);
    expect(sprite.result.current.byokConfigurable).toBe(false);

    // Unprovisionable: no key of any kind helps, so never configurable.
    const music = renderHook(() => useGenerationGate('music-generation'));
    expect(music.result.current.byokConfigurable).toBe(false);
  });
});

// The Sound dialog covers sfx AND voice and keeps its type radios enabled so
// the user can switch to whichever still works. Its entry points therefore
// close only when EVERY capability behind them is closed (#9725 p8).
describe('combineGenerationGates', () => {
  const open = (o: Partial<GenerationGateResult> = {}): GenerationGateResult => ({
    blocked: false, reason: undefined, loading: false, unprovisionable: false, byokConfigurable: false, ...o,
  });
  const shut = (o: Partial<GenerationGateResult> = {}): GenerationGateResult =>
    open({ blocked: true, reason: 'nope', unprovisionable: true, ...o });

  it('stays open while any one capability can still run', () => {
    const combined = combineGenerationGates([shut(), open()]);
    expect(combined.blocked).toBe(false);
    expect(combined.unprovisionable).toBe(false);
  });

  it('closes only when every capability is blocked', () => {
    const combined = combineGenerationGates([shut({ reason: 'first' }), shut({ reason: 'second' })]);
    expect(combined.blocked).toBe(true);
    expect(combined.reason).toBe('first');
    expect(combined.unprovisionable).toBe(true);
  });

  it('reports unprovisionable only when it is true of all of them', () => {
    const combined = combineGenerationGates([
      shut({ unprovisionable: true }),
      shut({ unprovisionable: false, byokConfigurable: true }),
    ]);
    expect(combined.blocked).toBe(true);
    expect(combined.unprovisionable).toBe(false);
    // One half cannot be fixed in Settings, so the pair cannot be either.
    expect(combined.byokConfigurable).toBe(false);
  });

  it('is loading, and never blocked, while any capability is still loading', () => {
    const combined = combineGenerationGates([shut(), open({ loading: true })]);
    expect(combined.loading).toBe(true);
    expect(combined.blocked).toBe(false);
  });
});
