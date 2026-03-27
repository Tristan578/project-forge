# Plan C: Themed Effects (Phases 3-4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** CSS-only ambient effects for all 7 themes, `ThemeAmbient` router component, `prefers-reduced-motion` enforcement, effects toggle, Chromatic baselines, Lighthouse CI gate.

**Depends on:** Plan B complete (Storybook + Chromatic for visual regression).

**Architecture:** All effects are pure CSS — animations, SVG `<animate>`, gradients, pseudo-elements. No canvas, no requestAnimationFrame, no JS particle systems. Each effect is a separate lazy-loaded component. `ThemeAmbient` reads `data-sf-theme` and renders the appropriate effect. Dark theme has no effect.

---

## Task C1: ThemeAmbient router component

**Files:**
- Create: `packages/ui/src/effects/ThemeAmbient.tsx`
- Test: `packages/ui/src/effects/__tests__/ThemeAmbient.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// packages/ui/src/effects/__tests__/ThemeAmbient.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeAmbient } from '../ThemeAmbient';

describe('ThemeAmbient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.documentElement.setAttribute('data-sf-theme', 'dark');
    document.documentElement.setAttribute('data-sf-effects', 'on');
  });

  it('renders null for dark theme (no effects)', () => {
    document.documentElement.setAttribute('data-sf-theme', 'dark');
    const { container } = render(<ThemeAmbient />);
    expect(container.querySelector('[data-sf-effect]')).toBeNull();
  });

  it('renders null when effects are off', () => {
    document.documentElement.setAttribute('data-sf-theme', 'ember');
    document.documentElement.setAttribute('data-sf-effects', 'off');
    const { container } = render(<ThemeAmbient />);
    expect(container.querySelector('[data-sf-effect]')).toBeNull();
  });

  it('renders null when prefers-reduced-motion is reduce', () => {
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
    const { container } = render(<ThemeAmbient />);
    expect(container.querySelector('[data-sf-effect]')).toBeNull();
  });

  it('renders effect container for non-dark theme with effects on', () => {
    document.documentElement.setAttribute('data-sf-theme', 'ember');
    const { container } = render(<ThemeAmbient />);
    const effect = container.querySelector('[data-sf-effect]');
    expect(effect).not.toBeNull();
    expect(effect?.getAttribute('data-sf-effect')).toBe('ember');
  });

  it('effect container has pointer-events: none', () => {
    document.documentElement.setAttribute('data-sf-theme', 'ice');
    const { container } = render(<ThemeAmbient />);
    const effect = container.querySelector('[data-sf-effect]');
    expect(effect).not.toBeNull();
    const style = window.getComputedStyle(effect!);
    // jsdom doesn't compute styles from classes, so check the inline/class
    expect(effect?.className).toContain('pointer-events-none');
  });
});
```

- [ ] **Step 2: Implement ThemeAmbient**

```tsx
// packages/ui/src/effects/ThemeAmbient.tsx
'use client';

import { lazy, Suspense, useState, useEffect } from 'react';
import type { ThemeName } from '../tokens';
import { Z_INDEX } from '../tokens';

const EmberGlow = lazy(() => import('./EmberGlow'));
const IceFrost = lazy(() => import('./IceFrost'));
const LeafDrift = lazy(() => import('./LeafDrift'));
const RustGears = lazy(() => import('./RustGears'));
const MechScanlines = lazy(() => import('./MechScanlines'));
const LightRays = lazy(() => import('./LightRays'));

const EFFECT_MAP: Partial<Record<ThemeName, React.LazyExoticComponent<React.FC>>> = {
  ember: EmberGlow,
  ice: IceFrost,
  leaf: LeafDrift,
  rust: RustGears,
  mech: MechScanlines,
  light: LightRays,
  // dark: no effect
};

/**
 * NOTE: This component MUST be imported with next/dynamic({ ssr: false })
 * in the main app to avoid hydration mismatch (server renders null,
 * client reads data-sf-theme from DOM).
 *
 * Example in EditorLayout.tsx:
 *   const ThemeAmbient = dynamic(
 *     () => import('@spawnforge/ui').then(m => ({ default: m.ThemeAmbient })),
 *     { ssr: false }
 *   );
 */
export function ThemeAmbient() {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [effectsOff, setEffectsOff] = useState(false);
  const [theme, setTheme] = useState<ThemeName>('dark');

  // Subscribe to prefers-reduced-motion changes
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mql.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Observe data-sf-effects attribute changes
  useEffect(() => {
    const root = document.documentElement;
    setEffectsOff(root.getAttribute('data-sf-effects') === 'off');
    setTheme((root.getAttribute('data-sf-theme') ?? 'dark') as ThemeName);

    const observer = new MutationObserver(() => {
      setEffectsOff(root.getAttribute('data-sf-effects') === 'off');
      setTheme((root.getAttribute('data-sf-theme') ?? 'dark') as ThemeName);
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-sf-effects', 'data-sf-theme'] });
    return () => observer.disconnect();
  }, []);

  if (reducedMotion || effectsOff) return null;

  const EffectComponent = EFFECT_MAP[theme];
  if (!EffectComponent) return null;

  return (
    <div
      data-sf-effect={theme}
      className="pointer-events-none fixed inset-0"
      style={{ zIndex: Z_INDEX.effects }}
      aria-hidden="true"
    >
      <Suspense fallback={null}>
        <EffectComponent />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 3: Run tests, verify passing**

- [ ] **Step 4: Commit**

---

## Task C2: EmberGlow effect (radial-gradient pulse + SVG sparks)

**Files:**
- Create: `packages/ui/src/effects/EmberGlow.tsx`
- Create: `packages/ui/src/effects/EmberGlow.module.css`

- [ ] **Step 1: Write the CSS animation**

```css
/* packages/ui/src/effects/EmberGlow.module.css */
@keyframes ember-pulse {
  0%, 100% { opacity: 0.3; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.05); }
}

@keyframes spark-float {
  0% { transform: translateY(0) rotate(0deg); opacity: 0.8; }
  100% { transform: translateY(-40px) rotate(45deg); opacity: 0; }
}

.glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse at 0% 50%,
    rgba(245, 158, 11, 0.08) 0%,
    transparent 50%
  );
  animation: ember-pulse 4s ease-in-out infinite;
}

.glowRight {
  composes: glow;
  background: radial-gradient(
    ellipse at 100% 50%,
    rgba(245, 158, 11, 0.06) 0%,
    transparent 50%
  );
  animation-delay: 2s;
}

.spark {
  position: absolute;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: rgba(245, 158, 11, 0.7);
  animation: spark-float 3s ease-out infinite;
}
```

- [ ] **Step 2: Write the component**

```tsx
// packages/ui/src/effects/EmberGlow.tsx
import styles from './EmberGlow.module.css';

const SPARK_POSITIONS = [
  { left: '5%', bottom: '30%', delay: '0s' },
  { left: '2%', bottom: '60%', delay: '1.2s' },
  { right: '3%', bottom: '40%', delay: '0.8s' },
  { right: '6%', bottom: '70%', delay: '2.1s' },
  { left: '8%', bottom: '50%', delay: '1.6s' },
];

export default function EmberGlow() {
  return (
    <>
      <div className={styles.glow} />
      <div className={styles.glowRight} />
      {SPARK_POSITIONS.map((pos, i) => (
        <div
          key={i}
          className={styles.spark}
          style={{ ...pos, animationDelay: pos.delay }}
        />
      ))}
    </>
  );
}
```

- [ ] **Step 3: Commit**

---

## Tasks C3-C7: Remaining 5 effects

Each follows the C2 pattern: CSS module with `@keyframes` + React component.

### Task C3: IceFrost (SVG stroke-dashoffset animation + CSS shimmer)

SVG paths define frost crack lines. `stroke-dashoffset` animates them "growing" across panel borders. CSS shimmer on focus rings uses `background: linear-gradient` animation.

### Task C4: LeafDrift (CSS translate animation + SVG border-image)

5-7 SVG leaf shapes positioned at sidebar edges. CSS `translate` + `rotate` keyframes create gentle drifting. Vine `border-image` applied to sidebar panel via CSS.

### Task C5: RustGears (CSS rotate on inline SVG)

3-4 small SVG gear shapes positioned on panel dividers. CSS `rotate` animation at different speeds. Subtle — gears are 12-16px, semi-transparent.

### Task C6: MechScanlines (CSS linear-gradient animation + pseudo-element brackets)

Full-width scan line using repeating `linear-gradient` moving vertically. HUD corner brackets on panels via `::before`/`::after` pseudo-elements with border styling.

### Task C7: LightRays (CSS radial-gradient animation)

Soft radial gradient positioned at toolbar area. Gentle opacity pulse. Minimal — just a warm glow on the toolbar background.

---

## Task C8: Storybook effect stories + Chromatic baselines

**Files:**
- Create: `apps/design/stories/effects/ThemeAmbient.stories.tsx`
- Modify: `apps/design/.storybook/main.ts` (add effects glob)

- [ ] **Step 1: Add effects story glob to main.ts**

```ts
stories.push('../stories/effects/**/*.stories.@(ts|tsx)');
```

- [ ] **Step 2: Write effect demo stories**

One story per theme showing the effect against a mock editor chrome layout.

- [ ] **Step 3: Run Chromatic to capture baselines**

```bash
cd apps/design && npx chromatic --project-token=$CHROMATIC_TOKEN
```

Expected: 13 baselines captured (Dark=1, 6 others=2 each for on/off).

- [ ] **Step 4: Commit**

---

## Task C9: Lighthouse CI setup

**Files:**
- Create: `.lighthouserc.js`
- Modify: `.github/workflows/quality-gates.yml`

- [ ] **Step 1: Install Lighthouse CI**

Add to root devDependencies:
```bash
npm install -D @lhci/cli
```

- [ ] **Step 2: Write Lighthouse config**

```js
// .lighthouserc.js
module.exports = {
  ci: {
    collect: {
      url: ['http://localhost:3000/dev'],
      startServerCommand: 'cd web && npm run dev',
      startServerReadyPattern: 'Ready in',
      numberOfRuns: 3,
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.5, aggregationMethod: 'median-run' }],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
```

- [ ] **Step 3: Add to CI (optional — can be manual pre-release check)**

```yaml
  lighthouse:
    name: Lighthouse Performance
    runs-on: ubuntu-latest
    needs: [web-tests]
    if: ${{ github.event_name == 'pull_request' }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: package-lock.json }
      - run: npm ci
      - run: cd packages/ui && npm run build
      - run: npx lhci autorun
```

- [ ] **Step 4: Commit**

---

## Task C10: E2E theme effect tests

**Files:**
- Create or modify: `web/e2e/tests/theme-effects.spec.ts`

- [ ] **Step 1: Write E2E tests**

```ts
// web/e2e/tests/theme-effects.spec.ts
import { test, expect } from '../fixtures/editor.fixture';
import { THEME_NAMES } from '@spawnforge/ui';

test.describe('Theme Effects @ui', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.loadPage();
  });

  test('dark theme has no effect element', async ({ page }) => {
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-sf-theme', 'dark');
      document.documentElement.setAttribute('data-sf-effects', 'on');
    });
    const effect = page.locator('[data-sf-effect]');
    await expect(effect).toHaveCount(0);
  });

  for (const theme of ['ember', 'ice', 'leaf', 'rust', 'mech', 'light'] as const) {
    test(`${theme} theme renders effect with animation`, async ({ page }) => {
      await page.evaluate((t) => {
        document.documentElement.setAttribute('data-sf-theme', t);
        document.documentElement.setAttribute('data-sf-effects', 'on');
      }, theme);

      const effect = page.locator(`[data-sf-effect="${theme}"]`);
      await expect(effect).toBeVisible({ timeout: 5000 });

      // Verify pointer-events: none
      const pe = await effect.evaluate((el) => getComputedStyle(el).pointerEvents);
      expect(pe).toBe('none');

      // Verify z-index = 5
      const zi = await effect.evaluate((el) => getComputedStyle(el).zIndex);
      expect(zi).toBe('5');
    });
  }

  test('effects disabled when data-sf-effects=off', async ({ page }) => {
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-sf-theme', 'ember');
      document.documentElement.setAttribute('data-sf-effects', 'off');
    });
    const effect = page.locator('[data-sf-effect]');
    await expect(effect).toHaveCount(0);
  });

  test('prefers-reduced-motion disables effects', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-sf-theme', 'ember');
      document.documentElement.setAttribute('data-sf-effects', 'on');
    });
    const effect = page.locator('[data-sf-effect]');
    await expect(effect).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Commit**

---

**Plan C complete.** Deliverables: 6 CSS-only ambient effects, ThemeAmbient router, Chromatic baselines, Lighthouse CI, E2E effect tests.
