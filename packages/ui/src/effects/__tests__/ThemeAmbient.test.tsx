import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { ThemeAmbient } from '../ThemeAmbient';

describe('ThemeAmbient', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-sf-theme', 'dark');
    document.documentElement.setAttribute('data-sf-effects', 'on');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.removeAttribute('data-sf-theme');
    document.documentElement.removeAttribute('data-sf-effects');
  });

  it('renders null for dark theme (no effects)', async () => {
    document.documentElement.setAttribute('data-sf-theme', 'dark');
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ThemeAmbient />));
    });
    expect(container.querySelector('[data-sf-effect]')).toBeNull();
  });

  it('renders null when effects are off', async () => {
    document.documentElement.setAttribute('data-sf-theme', 'ember');
    document.documentElement.setAttribute('data-sf-effects', 'off');
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ThemeAmbient />));
    });
    expect(container.querySelector('[data-sf-effect]')).toBeNull();
  });

  it('renders null when prefers-reduced-motion is reduce', async () => {
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
    document.documentElement.setAttribute('data-sf-theme', 'ember');
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ThemeAmbient />));
    });
    expect(container.querySelector('[data-sf-effect]')).toBeNull();
  });

  it('renders effect container for ember theme with effects on', async () => {
    document.documentElement.setAttribute('data-sf-theme', 'ember');
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ThemeAmbient />));
    });
    const effect = container.querySelector('[data-sf-effect]');
    expect(effect).not.toBeNull();
    expect(effect?.getAttribute('data-sf-effect')).toBe('ember');
  });

  it('renders effect container for ice theme with effects on', async () => {
    document.documentElement.setAttribute('data-sf-theme', 'ice');
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ThemeAmbient />));
    });
    const effect = container.querySelector('[data-sf-effect]');
    expect(effect).not.toBeNull();
    expect(effect?.getAttribute('data-sf-effect')).toBe('ice');
  });

  it('renders effect container for leaf theme with effects on', async () => {
    document.documentElement.setAttribute('data-sf-theme', 'leaf');
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ThemeAmbient />));
    });
    const effect = container.querySelector('[data-sf-effect]');
    expect(effect).not.toBeNull();
    expect(effect?.getAttribute('data-sf-effect')).toBe('leaf');
  });

  it('renders effect container for rust theme with effects on', async () => {
    document.documentElement.setAttribute('data-sf-theme', 'rust');
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ThemeAmbient />));
    });
    const effect = container.querySelector('[data-sf-effect]');
    expect(effect).not.toBeNull();
    expect(effect?.getAttribute('data-sf-effect')).toBe('rust');
  });

  it('renders effect container for mech theme with effects on', async () => {
    document.documentElement.setAttribute('data-sf-theme', 'mech');
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ThemeAmbient />));
    });
    const effect = container.querySelector('[data-sf-effect]');
    expect(effect).not.toBeNull();
    expect(effect?.getAttribute('data-sf-effect')).toBe('mech');
  });

  it('renders effect container for light theme with effects on', async () => {
    document.documentElement.setAttribute('data-sf-theme', 'light');
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ThemeAmbient />));
    });
    const effect = container.querySelector('[data-sf-effect]');
    expect(effect).not.toBeNull();
    expect(effect?.getAttribute('data-sf-effect')).toBe('light');
  });

  it('effect container has pointer-events-none class', async () => {
    document.documentElement.setAttribute('data-sf-theme', 'ice');
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ThemeAmbient />));
    });
    const effect = container.querySelector('[data-sf-effect]');
    expect(effect).not.toBeNull();
    expect(effect?.className).toContain('pointer-events-none');
  });

  it('effect container has aria-hidden="true"', async () => {
    document.documentElement.setAttribute('data-sf-theme', 'ember');
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ThemeAmbient />));
    });
    const effect = container.querySelector('[data-sf-effect]');
    expect(effect?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders null for dark theme even with effects on', async () => {
    document.documentElement.setAttribute('data-sf-theme', 'dark');
    document.documentElement.setAttribute('data-sf-effects', 'on');
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ThemeAmbient />));
    });
    expect(container.querySelector('[data-sf-effect]')).toBeNull();
  });

  it('switches from dark to ember when data-sf-theme attribute is mutated', async () => {
    // Start in dark theme — ThemeAmbient renders null
    document.documentElement.setAttribute('data-sf-theme', 'dark');
    document.documentElement.setAttribute('data-sf-effects', 'on');

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ThemeAmbient />));
    });
    expect(container.querySelector('[data-sf-effect]')).toBeNull();

    // Mutate data-sf-theme to 'ember' — the MutationObserver in ThemeAmbient
    // should pick up the change and re-render with the ember effect.
    await act(async () => {
      document.documentElement.setAttribute('data-sf-theme', 'ember');
    });

    const effect = container.querySelector('[data-sf-effect]');
    expect(effect).not.toBeNull();
    expect(effect?.getAttribute('data-sf-effect')).toBe('ember');
  });
});
