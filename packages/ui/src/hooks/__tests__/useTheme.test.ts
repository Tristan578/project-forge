import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Dynamic import for module reset
let useTheme: typeof import('../useTheme').useTheme;

// Minimal localStorage mock for jsdom
const localStorageMap = new Map<string, string>();
const localStorageMock: Storage = {
  getItem: (key: string) => localStorageMap.get(key) ?? null,
  setItem: (key: string, value: string) => { localStorageMap.set(key, value); },
  removeItem: (key: string) => { localStorageMap.delete(key); },
  clear: () => { localStorageMap.clear(); },
  get length() { return localStorageMap.size; },
  key: (index: number) => [...localStorageMap.keys()][index] ?? null,
};

describe('useTheme', () => {
  beforeEach(async () => {
    vi.resetModules();
    localStorageMap.clear();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });
    // Default matchMedia mock (no reduced motion)
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });
    document.documentElement.removeAttribute('data-sf-theme');
    document.documentElement.removeAttribute('data-sf-effects');
    const mod = await import('../useTheme');
    useTheme = mod.useTheme;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to dark when no localStorage', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
  });

  it('reads valid theme from localStorage', () => {
    localStorage.setItem('sf-theme', 'ember');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('ember');
  });

  it('falls back to dark for invalid localStorage value', () => {
    localStorage.setItem('sf-theme', 'notatheme');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
  });

  it('setTheme updates localStorage and data-sf-theme', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('ice'));
    expect(result.current.theme).toBe('ice');
    expect(localStorage.getItem('sf-theme')).toBe('ice');
    expect(document.documentElement.getAttribute('data-sf-theme')).toBe('ice');
  });

  it('effects default to on', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.effectsEnabled).toBe(true);
  });

  it('respects prefers-reduced-motion by forcing effects off', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    const { result } = renderHook(() => useTheme());
    expect(result.current.effectsEnabled).toBe(false);
  });

  it('custom theme (projectTheme param) overrides global localStorage', () => {
    localStorage.setItem('sf-theme', 'ice');
    const { result } = renderHook(() => useTheme({ projectTheme: 'ember' }));
    expect(result.current.theme).toBe('ember');
  });

  it('global localStorage wins over dark default when no projectTheme', () => {
    localStorage.setItem('sf-theme', 'leaf');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('leaf');
  });

  it('dark is the fallback when neither projectTheme nor localStorage are set', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
  });

  it('resolution priority: custom > project > global > dark', () => {
    localStorage.setItem('sf-theme', 'rust');
    const { result: withProject } = renderHook(() => useTheme({ projectTheme: 'mech' }));
    expect(withProject.current.theme).toBe('mech');

    const { result: withGlobal } = renderHook(() => useTheme());
    expect(withGlobal.current.theme).toBe('rust');

    localStorage.clear();
    const { result: withDark } = renderHook(() => useTheme());
    expect(withDark.current.theme).toBe('dark');
  });

  it('setEffectsEnabled with reduced-motion active stores "on" in localStorage but keeps effectsEnabled false (regression for bug fixed in 492354a6)', () => {
    // Simulate reduced-motion environment
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));

    const { result } = renderHook(() => useTheme());

    // Initial state: reduced-motion forces effects off
    expect(result.current.effectsEnabled).toBe(false);

    // User calls setEffectsEnabled(true) — preference should persist but runtime stays off
    act(() => result.current.setEffectsEnabled(true));

    // localStorage must store the user's preference ('on'), not the runtime override
    expect(localStorage.getItem('sf-effects')).toBe('on');

    // effectsEnabled must remain false because reduced-motion is active at runtime
    expect(result.current.effectsEnabled).toBe(false);
  });
});
