/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { _resetCapabilitiesCache, invalidateCapabilitiesCache, useCapabilities } from '../useFeatureGating';

const response = (available: boolean) => new Response(JSON.stringify({
  capabilities: [{ capability: 'model3d', available, label: '3D Model Generation' }],
  available: available ? ['model3d'] : [],
  unavailable: available ? [] : ['model3d'],
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
});
