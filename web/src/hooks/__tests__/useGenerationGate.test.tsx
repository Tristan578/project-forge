/**
 * useGenerationGate — the dialog-facing gate over /api/capabilities (#9117).
 *
 * `blocked` is true ONLY when the server has reported the feature
 * `unprovisionable` (declared unavailable in code). A plain `available:false`
 * — "no platform key here" — never blocks: a BYOK key may override it and a
 * stale cached body could misreport it, while the server refuses an
 * unprovisionable capability before any charge anyway. Loading and failed
 * fetches never block either.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useGenerationGate } from '../useGenerationGate';
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
      hint: 'Configure Meshy API key in Settings to enable 3D Model Generation.',
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
  unavailable: ['model3d', 'music', 'texture'],
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

  it('does NOT block a feature that is merely missing a platform key', async () => {
    respond(FIXTURE);
    const { result } = renderHook(() => useGenerationGate('model-generation'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.blocked).toBe(false);
    expect(result.current.reason).toBeUndefined();
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

  it('fails open when the capabilities fetch errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useGenerationGate('music-generation'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.blocked).toBe(false);
  });
});
