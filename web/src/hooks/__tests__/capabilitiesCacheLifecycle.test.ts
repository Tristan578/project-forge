/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { _resetCapabilitiesCache, invalidateCapabilitiesCache, useCapabilities } from '../useFeatureGating';

const response = (available: boolean) => new Response(JSON.stringify({
  capabilities: [{ capability: 'model3d', available, label: '3D Model Generation' }],
  available: available ? ['model3d'] : [],
  unavailable: available ? [] : ['model3d'],
  degraded: false,
}), { status: 200 });

describe('capabilities cache lifecycle (#9725)', () => {
  beforeEach(() => { _resetCapabilitiesCache(); vi.restoreAllMocks(); });
  afterEach(() => { cleanup(); _resetCapabilitiesCache(); vi.restoreAllMocks(); });

  it('refreshes mounted consumers immediately after a key or auth change', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(false)).mockResolvedValueOnce(response(true));
    const { result } = renderHook(() => useCapabilities());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => invalidateCapabilitiesCache());
    await waitFor(() => expect(result.current.available.has('model3d')).toBe(true));
    expect(fetchSpy).toHaveBeenLastCalledWith('/api/capabilities', { cache: 'no-store' });
  });

  // Nulling the cached body flipped every mounted consumer to loading:true for
  // the whole round trip, so useGenerationGate returned blocked:false, the
  // notice unmounted, disabled inputs re-enabled and the pills vanished — on
  // every sign-in/out and every BYOK save. Serve the previous body while
  // revalidating instead (#9725 p7).
  it('keeps serving the previous body while revalidating', async () => {
    let releaseSecond!: (value: Response) => void;
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(false))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { releaseSecond = resolve; }));
    const { result } = renderHook(() => useCapabilities());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.capabilities).toHaveLength(1);

    act(() => invalidateCapabilitiesCache());
    // Mid-flight: still the old answer, never an empty loading state.
    expect(result.current.loading).toBe(false);
    expect(result.current.capabilities).toHaveLength(1);
    expect(result.current.available.has('model3d')).toBe(false);

    await act(async () => { releaseSecond(response(true)); await Promise.resolve(); });
    await waitFor(() => expect(result.current.available.has('model3d')).toBe(true));
  });

  it('exposes the route\'s degraded flag to consumers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      capabilities: [{ capability: 'model3d', available: false, label: '3D Model Generation' }],
      available: [], unavailable: ['model3d'], degraded: true,
    }), { status: 200 }));
    const { result } = renderHook(() => useCapabilities());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.degraded).toBe(true);
  });

  it.each(['success', 'failure'])('ignores an old request ending in %s after invalidation', async (outcome) => {
    let resolveOld!: (value: Response) => void;
    let rejectOld!: (error: Error) => void;
    const old = new Promise<Response>((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(old).mockResolvedValueOnce(response(true));
    const { result } = renderHook(() => useCapabilities());
    act(() => invalidateCapabilitiesCache());
    // A new consumer must share the replacement request, not restart it.
    const other = renderHook(() => useCapabilities());
    await waitFor(() => expect(result.current.available.has('model3d')).toBe(true));
    await act(async () => {
      if (outcome === 'success') resolveOld(response(false));
      else rejectOld(new Error('old session failed'));
      await old.catch(() => {});
    });
    expect(result.current.available.has('model3d')).toBe(true);
    expect(other.result.current.available.has('model3d')).toBe(true);
    expect(result.current.error).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  // The stale-while-revalidate rewrite could WEDGE the module at loading:true
  // for the rest of the SPA session, which silently turns the whole #9117 gate
  // off (loading never blocks, so useGenerationGate reports blocked:false and
  // unprovisionable:false for every capability, music included). The sequence:
  // a consumer mounts and starts the first fetch, unmounts before it settles
  // (dialog closed, client navigation, stalled request), then an invalidation
  // fires with no subscribers left -- it nulls `fetchPromise` and starts no
  // replacement. Every later mount then found `cachedState` set and
  // `isCacheStale()` false, so it never refetched (#9725 p8).
  it('refetches after an invalidation that landed while nothing was mounted', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      // Never settles: the consumer that started it is gone before it would.
      .mockReturnValueOnce(new Promise<Response>(() => {}))
      .mockResolvedValueOnce(response(true));

    const first = renderHook(() => useCapabilities());
    expect(first.result.current.loading).toBe(true);
    first.unmount();

    act(() => invalidateCapabilitiesCache());

    const second = renderHook(() => useCapabilities());
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.available.has('model3d')).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
