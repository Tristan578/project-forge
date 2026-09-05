/**
 * useGenerationGate — the dialog-facing gate over /api/capabilities (#9117).
 *
 * `blocked` is true only when the server has POSITIVELY reported the feature
 * unavailable. While the fetch is in flight, or when it failed, the dialog
 * must not block: the server refuses an unavailable capability before any
 * charge anyway, so failing open here costs nothing and failing closed would
 * turn a transient /api/capabilities error into "all generation is off".
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

const MUSIC_OFF: CapabilitiesResponse = {
  capabilities: [
    { capability: 'sfx', available: true, label: 'Sound Effect Generation' },
    {
      capability: 'music',
      available: false,
      label: 'Music Generation',
      unprovisionable: true,
      hint: 'Music generation is unavailable (#9522).',
    },
  ],
  available: ['sfx'],
  unavailable: ['music'],
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

  it('blocks a feature the server reports unavailable and surfaces the hint', async () => {
    respond(MUSIC_OFF);
    const { result } = renderHook(() => useGenerationGate('music-generation'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.blocked).toBe(true);
    expect(result.current.reason).toContain('#9522');
  });

  it('does not block a feature the server reports available', async () => {
    respond(MUSIC_OFF);
    const { result } = renderHook(() => useGenerationGate('sfx-generation'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.blocked).toBe(false);
    expect(result.current.reason).toBeUndefined();
  });

  it('fails open when the capabilities fetch errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useGenerationGate('music-generation'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.blocked).toBe(false);
  });
});
