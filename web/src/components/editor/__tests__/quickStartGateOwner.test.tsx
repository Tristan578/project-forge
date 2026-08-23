/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import {
  claimQuickStartGate,
  useQuickStartOwnsGate,
  _resetQuickStartGateOwner,
} from '../quickStartGateOwner';

afterEach(() => {
  cleanup();
  _resetQuickStartGateOwner();
});

// PF-1215 round 2 (4/5): `getServerSnapshot` had no test anywhere -- it is a
// private, unexported function only reachable via `useQuickStartOwnsGate`'s
// third `useSyncExternalStore` argument. `useSyncExternalStore`'s dispatcher
// selection is determined by which React RENDERER performs the render, not
// by `typeof document` -- calling `react-dom/server`'s `renderToString`
// invokes React's server dispatcher (and therefore `getServerSnapshot`)
// regardless of the jsdom globals this file's environment provides, so no
// separate `@vitest-environment node` file is needed for this case.
function GateOwnerProbe() {
  const owns = useQuickStartOwnsGate();
  return <div data-testid="owns">{String(owns)}</div>;
}

describe('quickStartGateOwner', () => {
  it('reports no owner until something claims the gate', () => {
    const { result } = renderHook(() => useQuickStartOwnsGate());
    expect(result.current).toBe(false);
  });

  it('notifies subscribers when a claim is taken and released', () => {
    const { result } = renderHook(() => useQuickStartOwnsGate());

    let release = () => {};
    act(() => {
      release = claimQuickStartGate();
    });
    expect(result.current).toBe(true);

    act(() => release());
    expect(result.current).toBe(false);
  });

  it('stays claimed while a second claimant overlaps the first', () => {
    // A boolean flag would be clobbered here: releasing the first claim
    // would flip it straight to "unclaimed" while the second claimant is
    // still holding the gate, and the panel would render a second copy of
    // it. Counting survives the overlap.
    const { result } = renderHook(() => useQuickStartOwnsGate());

    let first = () => {};
    let second = () => {};
    act(() => {
      first = claimQuickStartGate();
      second = claimQuickStartGate();
    });
    act(() => first());
    expect(result.current).toBe(true);

    act(() => second());
    expect(result.current).toBe(false);
  });

  it('ignores a release called twice, so one claim cannot cancel another', () => {
    const { result } = renderHook(() => useQuickStartOwnsGate());

    let first = () => {};
    let second = () => {};
    act(() => {
      first = claimQuickStartGate();
      second = claimQuickStartGate();
    });

    act(() => {
      first();
      first();
    });
    expect(result.current).toBe(true);

    act(() => second());
    expect(result.current).toBe(false);
  });

  it('reports unclaimed during a server render even when something has claimed the gate', () => {
    // Claim BEFORE the server render -- if the hook's dispatcher ever read
    // the live `getSnapshot` during `renderToString` instead of
    // `getServerSnapshot`, this claim would flip the output to "true" and
    // prove it.
    const release = claimQuickStartGate();
    try {
      const html = renderToString(<GateOwnerProbe />);
      expect(html).toContain('false');
      expect(html).not.toContain('>true<');
    } finally {
      release();
    }
  });
});
