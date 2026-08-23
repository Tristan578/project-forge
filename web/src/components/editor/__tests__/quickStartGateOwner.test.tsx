/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import {
  claimQuickStartGate,
  useQuickStartOwnsGate,
  _resetQuickStartGateOwner,
} from '../quickStartGateOwner';

afterEach(() => {
  cleanup();
  _resetQuickStartGateOwner();
});

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

  it('stays claimed while a remount overlaps the unmount it replaces', () => {
    // React runs the new effect before the old cleanup on a remount, so a
    // boolean flag would be set then immediately cleared and the panel would
    // render a second copy of the gate. Counting survives the overlap.
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
});
