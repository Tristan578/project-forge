import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { ThemeAmbient } from '../ThemeAmbient';

/**
 * Assert the themed wrapper rendered AND that its lazily-imported effect
 * component actually mounted inside it.
 *
 * `ThemeAmbient` emits the `[data-sf-effect]` wrapper itself and puts the real
 * effect behind `<Suspense fallback={null}>`, so asserting only on the wrapper
 * passes while the dynamic `import()` is still pending — which it usually was.
 * Before PF-9453 not one of the six effect components' render functions was
 * executed by this suite in a typical run, and whether it ran at all varied
 * run to run (visible as ~1.7pp of nondeterministic function coverage in this
 * package). A completely broken effect component would not have failed a
 * single one of these tests. `waitFor` drives the pending import to
 * resolution; a non-empty wrapper is proof the lazy child mounted, because
 * `fallback={null}` renders nothing.
 */
async function expectEffectMounted(container: HTMLElement, theme: string): Promise<void> {
  const effect = container.querySelector('[data-sf-effect]');
  expect(effect).not.toBeNull();
  expect(effect!.getAttribute('data-sf-effect')).toBe(theme);
  await waitFor(() => {
    expect(effect!.childElementCount).toBeGreaterThan(0);
  });
}

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
    await expectEffectMounted(container, 'ember');
  });

  it('renders effect container for ice theme with effects on', async () => {
    document.documentElement.setAttribute('data-sf-theme', 'ice');
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ThemeAmbient />));
    });
    await expectEffectMounted(container, 'ice');
  });

  it('renders effect container for leaf theme with effects on', async () => {
    document.documentElement.setAttribute('data-sf-theme', 'leaf');
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ThemeAmbient />));
    });
    await expectEffectMounted(container, 'leaf');
  });

  it('renders effect container for rust theme with effects on', async () => {
    document.documentElement.setAttribute('data-sf-theme', 'rust');
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ThemeAmbient />));
    });
    await expectEffectMounted(container, 'rust');
  });

  it('renders effect container for mech theme with effects on', async () => {
    document.documentElement.setAttribute('data-sf-theme', 'mech');
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ThemeAmbient />));
    });
    await expectEffectMounted(container, 'mech');
  });

  it('renders effect container for light theme with effects on', async () => {
    document.documentElement.setAttribute('data-sf-theme', 'light');
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ThemeAmbient />));
    });
    await expectEffectMounted(container, 'light');
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

    await expectEffectMounted(container, 'ember');
  });
});
