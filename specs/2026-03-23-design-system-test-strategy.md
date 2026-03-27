# SpawnForge UI — Design System Test Strategy

**Spec ID:** 2026-03-23-design-system-test-strategy
**Status:** Draft
**Author:** QA Lead
**Date:** 2026-03-23

---

## User Workflow Narratives

### Persona: Engineer adding a new design system component

1. An engineer opens a ticket to implement a `ColorPicker` component for the material inspector.
2. They open this spec and read Section 3.4 (Form Controls). The required test cases are listed explicitly — 17 required tests covering render, interaction, ref, accessibility, and theme.
3. They implement `ColorPicker.tsx` and `__tests__/ColorPicker.test.tsx` in parallel, referencing the test template in Section 7.
4. Before opening a PR, they run `cd web && npx vitest run src/components/ui/__tests__/ColorPicker.test.tsx`. All 17 tests pass. Coverage is 100% statements, 96% branches.
5. The PR CI pipeline runs lint, tsc, vitest, and the Playwright accessibility job. The axe-core audit in `accessibility-audit.spec.ts` includes a scoped scan of `[data-testid="ds-color-picker"]`. Zero violations.
6. A reviewer checks the PR against Section 10 (Quick-Reference Checklist). The new component passes all gates. It merges.
7. The coverage ratchet step runs on main: statement coverage is now 0.4 points above the previous threshold. The ratchet commits `chore: ratchet coverage thresholds` automatically.
8. Next sprint, a second engineer builds a form that uses `ColorPicker`. They run the full suite locally — the 17 existing tests catch a regression where a prop rename broke `aria-label` forwarding. The PR is blocked before merge.

**Expected outcome:** Every design system component ships with a complete, reproducible test suite. Engineers never need to decide which tests to write — the spec decides for them. Quality regressions are caught in < 5 minutes, not in production.

---

### Persona: UX engineer validating a theme change

1. The UX lead changes `--color-primary` in the design token file from `oklch(60% 0.2 250)` to `oklch(55% 0.25 260)`.
2. The visual regression job in CI runs `npx playwright test design-system-visual --project=chromium`. It compares screenshots of the button grid against the committed baseline.
3. The `ds-button-grid.png` diff shows 3.2% pixel deviation — above the 1% threshold for primitives.
4. CI fails with a clear diff image attached. The UX lead reviews: the color shift is intentional. They run `npx playwright test design-system-visual --update-snapshots` locally, commit the new baselines alongside the token change, and re-push.
5. CI passes on the second run. The new token value is now the approved baseline.

**Expected outcome:** Unintentional visual regressions are caught automatically. Intentional design changes require a deliberate baseline update, creating a clear audit trail.

---

### Persona: Accessibility auditor reviewing a release candidate

1. Before a quarterly release, the QA lead runs `npx playwright test accessibility-audit --project=chromium`.
2. The axe scan finds a `color-contrast` violation on the secondary button variant in light theme — the `zinc-400` label text against the `zinc-100` background is 3.8:1, below the 4.5:1 WCAG AA minimum.
3. The violation surfaces with the exact element path, the failing contrast ratio, and the required ratio. No manual color-picker needed.
4. The engineer adjusts the token to `zinc-600` (5.1:1 contrast). Re-run passes.
5. The release ships without accessibility regressions.

**Expected outcome:** WCAG compliance is a continuous CI gate, not a pre-release scramble. Contrast failures are caught with exact reproduction steps.

---

## 1. Overview

This document defines the test requirements, patterns, and quality gates for the SpawnForge UI design system — a shared component library of buttons, modals, inputs, panels, and related primitives with full theming support (dark / light / custom).

Every implementation ticket for a design system component MUST reference this document and satisfy all applicable sections.

---

## 2. Infrastructure Baseline

### 2.1 Existing test stack (as of 2026-03-23)

| Tool | Version | Role |
|------|---------|------|
| vitest | 4.0.18 | Unit + integration test runner |
| @testing-library/react | 16.3.x | Component rendering, queries, events |
| @testing-library/jest-dom | 6.9.x | DOM assertion matchers |
| @testing-library/dom | 10.4.x | Low-level DOM utilities |
| jsdom | 29.x | Browser simulation in Node |
| @playwright/test | 1.58.x | E2E browser automation |
| @axe-core/playwright | 4.11.x | WCAG automated audits in E2E |
| @vitest/coverage-v8 | 4.0.18 | V8 coverage provider |

### 2.2 Configuration files

- Vitest: `web/vitest.config.ts` — environment `jsdom`, pool `forks`, 30 s timeout
- Playwright: `web/playwright.config.ts` — chromium + firefox + webkit + mobile profiles
- Shared render utility: `web/src/test/utils/componentTestUtils.tsx`
- Global setup: `web/vitest.setup.ts` — localStorage polyfill + afterEach cleanup

### 2.3 Coverage thresholds (current sprint — Tier-2 target)

```
statements : 70%
branches   : 60%
functions  : 65%
lines      : 72%
```

Design system components are expected to meet **100% statements / 95% branches / 100% functions** given their narrow surface area and high reuse. They should never drag the project average down.

### 2.4 Render wrapper

`componentTestUtils.tsx` currently wraps `@testing-library/react`'s `render` without any providers. When design system components require a ThemeProvider, this wrapper MUST be extended:

```typescript
// web/src/test/utils/componentTestUtils.tsx — extend when ThemeProvider lands
import { ThemeProvider } from '@/components/ui/ThemeProvider';

function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & { theme?: 'dark' | 'light' | string }
) {
  const theme = options?.theme ?? 'dark';
  return render(
    <ThemeProvider defaultTheme={theme}>{ui}</ThemeProvider>,
    { ...options }
  );
}
```

All design system component tests MUST use `renderWithProviders` (aliased as `render` from the utility), not the bare `@testing-library/react` render.

---

## 3. Test Pyramid for Design System Components

### 3.1 Primitives

Primitives are stateless or near-stateless leaf components: Button, Input, Select, Checkbox, Radio, Toggle, Slider, Badge, Tag, Icon, Avatar, Spinner, Tooltip.

#### Required test cases for every primitive

| Category | Test cases |
|----------|-----------|
| Render | Default state renders without crashing |
| Render | Each declared variant (e.g. `primary`, `secondary`, `ghost`, `danger`) |
| Render | Each declared size (e.g. `sm`, `md`, `lg`) |
| Render | Disabled state — element has `disabled` attribute or `aria-disabled="true"` |
| Render | Loading state (where applicable) — spinner visible, interaction blocked |
| Ref forwarding | `React.forwardRef` — forwarded ref points to the DOM node |
| className | Custom `className` prop merges with base classes without overwriting them |
| Interaction | Click fires `onClick` (Button, Toggle, Checkbox) |
| Interaction | Focus and blur fire `onFocus` / `onBlur` |
| Interaction | Enter / Space activates clickable primitives |
| Interaction | Escape clears clearable inputs |
| Interaction | Tab order is not disrupted |
| Accessibility | Correct ARIA role (e.g. `button`, `checkbox`, `switch`, `combobox`) |
| Accessibility | `aria-label` present when icon-only (no visible text) |
| Accessibility | `aria-disabled="true"` when disabled |
| Accessibility | `aria-pressed` / `aria-checked` / `aria-selected` reflect state |
| Accessibility | `focus-visible` class or outline applied on keyboard focus |
| Theme | Renders correctly in `dark` theme |
| Theme | Renders correctly in `light` theme |
| Theme | No hardcoded color values in rendered output (all via CSS custom properties) |

**Total minimum per primitive:** ~18 test cases. Icon-only components add 2 aria tests.

#### Example — Button

```typescript
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { Button } from '@/components/ui/Button';

describe('Button', () => {
  afterEach(() => cleanup());

  // --- Render ---
  it('renders without crashing', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeDefined();
  });

  it.each(['primary', 'secondary', 'ghost', 'danger'] as const)(
    'renders variant=%s',
    (variant) => {
      const { container } = render(<Button variant={variant}>Label</Button>);
      expect(container.firstElementChild).toBeDefined();
    }
  );

  it.each(['sm', 'md', 'lg'] as const)('renders size=%s', (size) => {
    render(<Button size={size}>Label</Button>);
    expect(screen.getByRole('button')).toBeDefined();
  });

  it('is disabled when disabled prop is set', () => {
    render(<Button disabled>Label</Button>);
    expect(screen.getByRole('button').getAttribute('disabled')).not.toBeNull();
  });

  // --- Ref ---
  it('forwards ref to the button element', () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<Button ref={ref}>Label</Button>);
    expect(ref.current?.tagName).toBe('BUTTON');
  });

  // --- className ---
  it('merges custom className without losing base classes', () => {
    render(<Button className="my-custom-class">Label</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('my-custom-class');
    // Base class from the design system variant should still be present
    expect(btn.className.length).toBeGreaterThan('my-custom-class'.length);
  });

  // --- Interaction ---
  it('fires onClick when clicked', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick when disabled', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('activates on Enter key', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Press</Button>);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('activates on Space key', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Press</Button>);
    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // --- Accessibility ---
  it('has role=button', () => {
    render(<Button>Label</Button>);
    expect(screen.getByRole('button')).toBeDefined();
  });

  it('icon-only button requires aria-label', () => {
    render(<Button aria-label="Close dialog" iconOnly />);
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeDefined();
  });

  it('aria-disabled is true when disabled', () => {
    render(<Button disabled>Label</Button>);
    const btn = screen.getByRole('button');
    // Either native disabled OR aria-disabled="true" is acceptable
    const isDisabled =
      btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true';
    expect(isDisabled).toBe(true);
  });

  // --- Theme ---
  it('renders in dark theme', () => {
    render(<Button>Label</Button>, { theme: 'dark' });
    expect(screen.getByRole('button')).toBeDefined();
  });

  it('renders in light theme', () => {
    render(<Button>Label</Button>, { theme: 'light' });
    expect(screen.getByRole('button')).toBeDefined();
  });
});
```

---

### 3.2 Containers

Containers manage layout, lifecycle, and focus: Modal, Dialog, Drawer, Panel, Sheet, Tabs, Accordion, Popover, DropdownMenu.

#### Required test cases for every container

| Category | Test cases |
|----------|-----------|
| Mount / unmount | Component mounts without crashing |
| Mount / unmount | `open={false}` does not render children into the DOM (or renders hidden) |
| Mount / unmount | Transitioning `open` from false → true makes content visible |
| Mount / unmount | Transitioning `open` from true → false hides / removes content |
| Focus trap | When opened, focus moves into the container |
| Focus trap | Tab key cycles through focusable elements within the container |
| Focus trap | Shift+Tab cycles backwards |
| Focus trap | Focus does not escape the container while it is open |
| Keyboard | Escape key calls `onClose` / `onDismiss` |
| Keyboard | Escape key does not propagate past the component |
| Click outside | Clicking the backdrop calls `onClose` when `closeOnBackdropClick` is true |
| Click outside | Clicking the backdrop does nothing when `closeOnBackdropClick` is false |
| Animation | Enter animation class or data-attribute is applied when opening |
| Animation | Exit animation class or data-attribute is applied when closing |
| Nesting | Inner modal Escape only closes the inner modal, not the outer |
| Body scroll | `document.body` has overflow-hidden (or scroll-locked class) while modal is open |
| Body scroll | Body scroll lock is released on close |
| Accessibility | `role="dialog"` or `role="alertdialog"` |
| Accessibility | `aria-modal="true"` |
| Accessibility | `aria-labelledby` references the visible heading |
| Accessibility | `aria-describedby` references description text (where applicable) |
| Theme | Renders correctly in dark and light themes |

**Total minimum per container:** ~22 test cases.

#### Tabs — additional tests

- Active tab has `aria-selected="true"`, inactive tabs have `aria-selected="false"`
- `tablist` role on the tab list element
- Arrow keys navigate between tabs
- Selected panel content is visible; unselected panels are not

#### Accordion — additional tests

- Collapsed state: content hidden, `aria-expanded="false"` on trigger
- Expanded state: content visible, `aria-expanded="true"` on trigger
- Toggle click expands a collapsed item and collapses an expanded item
- `allowMultiple={false}`: opening a second item collapses the first

---

### 3.3 Feedback Components

Feedback components communicate status asynchronously: Toast, Alert, Banner, Progress, Skeleton, EmptyState.

#### Required test cases for every feedback component

| Category | Test cases |
|----------|-----------|
| Render | Renders info, success, warning, error variants |
| Render | Renders with title only, message only, and both |
| Render | Icon renders for each variant (or no icon when `hideIcon` is set) |
| Render | Dismissible variant shows close button |
| Interaction | Clicking close button calls `onClose` / `onDismiss` |
| Toast: auto-dismiss | Calls `onClose` after `duration` ms (use `vi.useFakeTimers`) |
| Toast: hover-to-persist | `onClose` is NOT called during hover when `pauseOnHover` is true |
| Toast: queue | Multiple toasts stack and each dismisses independently |
| Toast: position | Top-left, top-right, bottom-left, bottom-right, top-center, bottom-center variants render in correct DOM position |
| Progress | Percentage value is reflected in `aria-valuenow` |
| Progress | Indeterminate state has no `aria-valuenow` |
| Accessibility | Alert role: `role="alert"` for urgent, `role="status"` for informational |
| Theme | Renders correctly in dark and light themes |

#### Toast — fake timer pattern

```typescript
import { vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('auto-dismisses after duration', () => {
  const onClose = vi.fn();
  render(<Toast message="Saved" duration={3000} onClose={onClose} />);
  expect(onClose).not.toHaveBeenCalled();
  vi.advanceTimersByTime(3001);
  expect(onClose).toHaveBeenCalledTimes(1);
});
```

---

### 3.4 Form Controls

Form controls integrate with React Hook Form and native form semantics: TextInput, TextArea, Select, Combobox, DatePicker, ColorPicker, FileInput, FormField (label + input + error wrapper).

#### Required test cases for every form control

| Category | Test cases |
|----------|-----------|
| Render | Default empty state |
| Render | Pre-populated value |
| Render | Placeholder text |
| Render | Disabled state |
| Render | Read-only state |
| Render | Error state — error message visible, `aria-invalid="true"`, red border variant |
| Render | Required state — `aria-required="true"` |
| Interaction | `onChange` fires with the new value on user input |
| Interaction | `onBlur` fires when focus leaves the control |
| Interaction | Controlled mode — value does not change without external state update |
| Interaction | Uncontrolled mode — value updates internally |
| Interaction | Clearing the field fires `onChange` with empty string |
| Ref | `ref` points to the underlying input element |
| Accessibility | Associated `<label>` via `htmlFor` or `aria-label` |
| Accessibility | Error message linked via `aria-describedby` when in error state |
| Accessibility | `aria-invalid="true"` when in error state |
| Accessibility | `aria-required="true"` when required |
| Theme | Renders correctly in dark and light themes |

---

## 4. Accessibility Testing Matrix

### 4.1 What to test and when

| Test type | Tool | Scope | When to run |
|-----------|------|-------|-------------|
| ARIA role and attributes | `@testing-library/react` queries | Every component | Every unit test |
| Keyboard navigation (Tab, Arrow, Enter, Space, Escape) | `@testing-library/user-event` | Every interactive component | Every unit test |
| Focus management — focus moves to correct element | `document.activeElement` assertion | Modals, dialogs, menus | Every container unit test |
| Focus trap — focus stays within container | `userEvent.tab()` cycle | All overlays | Every modal/drawer unit test |
| WCAG 2.1 AA automated scan | `@axe-core/playwright` | Per-component Playwright test | E2E accessibility job |
| Color contrast (WCAG AA: 4.5:1 text, 3:1 UI) | `@axe-core/playwright` | Theme-specific E2E test | E2E accessibility job |
| Reduced motion — animations skip when `prefers-reduced-motion: reduce` | CSS media query mock | Animation components | Unit test |
| Screen reader text — icon-only components have visible labels | `getByRole` with `name` | All icon-only components | Every unit test |

### 4.2 Reduced motion mock pattern

```typescript
it('skips animation when prefers-reduced-motion is active', () => {
  // Mock the media query before rendering
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  const { container } = render(<AnimatedModal open />);
  const animatedEl = container.querySelector('[data-animated]');
  // When reduced motion is active, the element should have no transition-duration
  expect(animatedEl?.className).not.toContain('transition-');
});
```

### 4.3 Focus management pattern

```typescript
import userEvent from '@testing-library/user-event';

it('moves focus into modal when opened', async () => {
  const user = userEvent.setup();
  render(<Modal open onClose={vi.fn()}>
    <button>First focusable</button>
  </Modal>);
  // After opening, the first focusable element should be active
  await user.tab();
  expect(document.activeElement?.textContent).toBe('First focusable');
});

it('returns focus to trigger when modal closes', async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <div>
      <button data-testid="trigger">Open</button>
      <Modal open onClose={vi.fn()}><button>Inside</button></Modal>
    </div>
  );
  const trigger = screen.getByTestId('trigger');
  trigger.focus();
  rerender(
    <div>
      <button data-testid="trigger">Open</button>
      <Modal open={false} onClose={vi.fn()}><button>Inside</button></Modal>
    </div>
  );
  expect(document.activeElement).toBe(trigger);
});
```

### 4.4 WCAG compliance targets

| WCAG criterion | Target | Enforcement |
|---------------|--------|-------------|
| 1.4.3 Contrast (Minimum) | AA — 4.5:1 for normal text, 3:1 for large text | axe-core E2E |
| 1.4.11 Non-text Contrast | AA — 3:1 for UI components | axe-core E2E |
| 2.1.1 Keyboard | All interactive elements keyboard operable | Unit tests |
| 2.4.3 Focus Order | Focus order matches visual order | Unit + E2E |
| 2.4.7 Focus Visible | Focus indicator visible on all keyboard-focusable elements | Unit tests |
| 4.1.2 Name, Role, Value | All UI components have accessible name, role, state | Unit tests |

---

## 5. Theme Testing Strategy

### 5.1 Approach

SpawnForge UI uses CSS custom properties (design tokens) for all colors, spacing, and type scales. Components must never embed hardcoded color values.

The ThemeProvider applies a `data-theme="dark"` (or `"light"` / custom name) attribute to the root element. CSS selectors use `[data-theme="dark"] { --color-bg: ... }` patterns.

### 5.2 Unit-level theme tests

For every component, render under both `dark` and `light` themes and assert:

1. The component renders without error
2. The root element's computed style references CSS custom properties (not hardcoded hex/rgb values)
3. The text content is readable (a11y check covers contrast)

```typescript
it.each(['dark', 'light'] as const)('renders in %s theme without error', (theme) => {
  expect(() => {
    render(<Button variant="primary">Label</Button>, { theme });
  }).not.toThrow();
  expect(screen.getByRole('button')).toBeDefined();
});
```

### 5.3 CSS custom property lint rule

Add an ESLint rule (or Stylelint rule if CSS-in-JS is not used) that flags hardcoded color values in component files:

```js
// .eslintrc equivalent — no-restricted-syntax rule
{
  "selector": "Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
  "message": "Use CSS custom property token instead of hardcoded hex color."
}
```

This fires at lint time, before any test runs.

### 5.4 Custom theme test

Design system components must accept and correctly apply arbitrary theme tokens. Test this with a synthetic theme:

```typescript
const customTheme = {
  '--color-primary': 'oklch(60% 0.2 250)',
  '--color-primary-fg': 'oklch(98% 0 0)',
};

it('applies custom theme tokens', () => {
  render(
    <ThemeProvider tokens={customTheme}>
      <Button variant="primary">Label</Button>
    </ThemeProvider>
  );
  const btn = screen.getByRole('button');
  // The element should carry the custom property via inline styles or data-theme
  const style = window.getComputedStyle(btn);
  // In jsdom, CSS custom properties are not computed — assert the token exists in the DOM
  expect(btn.closest('[style]')?.getAttribute('style')).toContain('--color-primary');
});
```

Note: jsdom does not evaluate CSS cascade. Contrast verification for custom themes is an E2E concern (see section 6).

### 5.5 Theme switching test (E2E)

```typescript
// web/e2e/tests/design-system-themes.spec.ts
test('switching from dark to light theme re-renders button with correct token values', async ({ page }) => {
  await page.goto('/dev');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

  const btn = page.locator('[data-testid="ds-button-primary"]').first();
  const darkBg = await btn.evaluate((el) =>
    getComputedStyle(el).getPropertyValue('--color-primary').trim()
  );

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  const lightBg = await btn.evaluate((el) =>
    getComputedStyle(el).getPropertyValue('--color-primary').trim()
  );

  expect(darkBg).not.toBe('');
  expect(lightBg).not.toBe('');
  expect(darkBg).not.toBe(lightBg); // tokens differ between themes
});
```

---

## 6. Visual Regression Strategy

### 6.1 Tool selection

Visual regression uses Playwright's built-in snapshot matching (`toMatchSnapshot`). The existing `visual-regression.spec.ts` establishes the pattern — design system extends it.

`@axe-core/playwright` is already installed for contrast audits in E2E. No additional visual diff tools are required for the initial rollout.

### 6.2 Component storybook-lite fixture page

Create a dedicated fixture page at `/dev/design-system` (gated behind the same `/dev` route guard used by the editor). This page renders every design system component variant in a stable grid layout, suitable for visual regression baselines.

```
/dev/design-system
  └── ButtonGrid        (all variants × sizes × states)
  └── InputGrid         (default, error, disabled, loading)
  └── ModalDemo         (open state captured post-interaction)
  └── ThemeSwitcher     (side-by-side dark / light)
  └── ToastStack        (all position variants)
  └── FormGrid          (all form controls)
```

### 6.3 Playwright snapshot tests

```typescript
// web/e2e/tests/design-system-visual.spec.ts
test.describe('Design System Visual Regression @visual', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/design-system');
    await page.waitForLoadState('networkidle');
  });

  test('Button grid matches baseline', async ({ page }) => {
    const grid = page.locator('[data-testid="ds-button-grid"]');
    await expect(grid).toBeVisible();
    expect(await grid.screenshot()).toMatchSnapshot('ds-button-grid.png', {
      maxDiffPixelRatio: 0.02, // 2% pixel deviation allowed
    });
  });

  test('Input grid matches baseline — dark theme', async ({ page }) => {
    const grid = page.locator('[data-testid="ds-input-grid"]');
    expect(await grid.screenshot()).toMatchSnapshot('ds-input-grid-dark.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('Input grid matches baseline — light theme', async ({ page }) => {
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    const grid = page.locator('[data-testid="ds-input-grid"]');
    expect(await grid.screenshot()).toMatchSnapshot('ds-input-grid-light.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});
```

### 6.4 Baseline image management

- Baseline images are committed to the repository under `web/e2e/snapshots/`
- Baselines are established once by running: `npx playwright test design-system-visual --update-snapshots`
- Baselines are regenerated on intentional design changes (update comes with the PR)
- CI fails if a component drifts beyond the 2% pixel ratio threshold

### 6.5 Diff thresholds by component class

| Component class | maxDiffPixelRatio | Rationale |
|----------------|-------------------|-----------|
| Primitives (Button, Input, Badge) | 0.01 (1%) | Pixel-stable — no animations |
| Containers (Modal, Drawer) | 0.02 (2%) | May have shadow anti-aliasing variance |
| Feedback (Toast, Progress) | 0.02 (2%) | Color gradients |
| Form controls | 0.01 (1%) | Pixel-stable |

### 6.6 Font rendering variance

Font rendering differs between OS and CI runner. To avoid false positives:
- Use `page.emulateMedia({ colorScheme: 'dark' })` for consistent theme state
- Set `--disable-font-subpixel-positioning` in Playwright launch args for design-system tests
- Or use the `mask` option to mask font-rendered text areas and focus on layout/color

---

## 7. Per-Component Test Requirements Template

Every design system component implementation ticket MUST include this section verbatim, filled in for the specific component.

---

### Test Requirements for [ComponentName]

**Component category:** [Primitive / Container / Feedback / Form Control]
**Source file:** `web/src/components/ui/[ComponentName].tsx`
**Test file:** `web/src/components/ui/__tests__/[ComponentName].test.tsx`

#### Unit Tests (vitest + @testing-library/react)

```
[ ] Renders without crashing
[ ] Renders each variant: [list variants from component API]
[ ] Renders each size: [list sizes, or N/A]
[ ] Renders disabled state (element is disabled, interactions blocked)
[ ] Forwards ref to underlying DOM element
[ ] Merges custom className without overwriting base classes
[ ] [Add component-specific render cases here]
```

**Interaction tests:**

```
[ ] onClick / onChange / onClose fires with correct arguments
[ ] Keyboard: Enter activates [specify behavior]
[ ] Keyboard: Space activates [specify behavior]
[ ] Keyboard: Escape [specify behavior — dismiss, clear, no-op]
[ ] Keyboard: Tab does not trap focus [Primitive] / does trap focus [Container]
[ ] [Add component-specific keyboard cases here]
```

**Container-specific (Modals, Dialogs, Drawers, Popovers):**

```
[ ] open=false does not render content
[ ] open=true renders content and moves focus
[ ] Escape key calls onClose
[ ] Backdrop click calls onClose (when closeOnBackdropClick=true)
[ ] Backdrop click does nothing (when closeOnBackdropClick=false)
[ ] Body scroll is locked while open
[ ] Body scroll lock is released on close
[ ] Focus returns to trigger element on close
```

#### Accessibility Tests

```
[ ] Has correct role="[specify: button/checkbox/dialog/combobox/etc.]"
[ ] Has aria-label when icon-only (no visible text)
[ ] aria-disabled="true" when disabled
[ ] aria-expanded reflects open/closed state [Container]
[ ] aria-selected reflects active state [Tabs, List items]
[ ] aria-invalid="true" in error state [Form controls]
[ ] aria-required="true" when required [Form controls]
[ ] aria-describedby links to error message [Form controls]
[ ] aria-labelledby links to heading [Container]
[ ] aria-modal="true" [Overlay containers]
[ ] Keyboard reachable via Tab
[ ] Activatable via Enter and/or Space
[ ] focus-visible outline visible on keyboard focus (check for focus-visible class)
[ ] axe-core: zero violations (run in E2E accessibility-audit.spec.ts)
```

#### Theme Tests

```
[ ] Renders correctly in dark theme (no crash, content visible)
[ ] Renders correctly in light theme (no crash, content visible)
[ ] Uses CSS custom properties — no hardcoded colors in component file (enforced by ESLint)
[ ] Text contrast >= 4.5:1 in all themes (enforced by axe-core E2E)
```

#### Visual Regression Tests (E2E)

```
[ ] Baseline snapshot committed for: default state, each variant, disabled state
[ ] Baseline snapshot committed for: dark theme, light theme
[ ] Playwright maxDiffPixelRatio: [0.01 for Primitives / 0.02 for Containers]
```

#### Coverage Target

```
Statements : 100%
Branches   : 95%  (impossible branches e.g. TypeScript exhaustiveness guards are exempt)
Functions  : 100%
Lines      : 100%
```

---

## 8. CI Integration

### 8.1 Existing pipeline structure

The SpawnForge CI runs the following jobs (relevant to design system):

1. `lint` — `cd web && npx eslint --max-warnings 0 .`
2. `tsc` — `cd web && npx tsc --noEmit`
3. `vitest` — `cd web && npx vitest run` (all unit + integration tests, including design system)
4. `playwright` — `cd web && npx playwright test` (E2E, including accessibility and visual regression)

Design system tests slot into jobs 3 and 4 with no pipeline changes required.

### 8.2 Accessibility job gate

The `accessibility-audit.spec.ts` file already has the axe integration pattern. Design system components add scoped audits following that pattern:

```typescript
// web/e2e/tests/accessibility-audit.spec.ts — add per component
test('Button variants have zero critical or serious axe violations', async ({ page }) => {
  await page.goto('/dev/design-system');
  const results = await new AxeBuilder({ page })
    .include('[data-testid="ds-button-grid"]')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  const issues = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious'
  );
  expect(issues, issues.map((v) => `[${v.impact}] ${v.id}: ${v.description}`).join('\n')).toHaveLength(0);
});
```

Each component category gets one axe test block in `accessibility-audit.spec.ts`.

### 8.3 Visual regression job

Visual regression tests are tagged `@visual` and can be run in isolation:

```bash
npx playwright test design-system-visual --project=chromium
```

In CI, visual regression runs on a dedicated matrix job that uses a pinned container image (consistent font rendering). It is advisory (non-blocking) until all baselines are stable, then becomes a required gate.

### 8.4 Coverage ratchet

Each design system component ships with 100% statement coverage. The coverage thresholds in `web/vitest.config.ts` are ratcheted up after each component merges, following the pattern in `docs/coverage-plan.md`.

Thresholds are never lowered to accommodate a new component. A new component that does not achieve 100% coverage is not ready to merge.

### 8.5 Design system lint rule additions

Add these rules to the project ESLint config when the design system ships:

| Rule | Purpose |
|------|---------|
| No hardcoded hex/rgb colors in `components/ui/**` | Enforce CSS custom property use |
| `aria-label` required on icon-only components | Accessibility gate at lint time |
| `data-testid` required on root element of every design system component | Enables stable test selectors and visual regression scoping |

---

## 9. Performance Targets

Design system components must not degrade the editor's runtime performance or CI pipeline speed. These are hard targets — not aspirational.

### 9.1 Runtime Performance (Editor Application)

| Metric | Target | Measurement method |
|--------|--------|--------------------|
| LCP (Largest Contentful Paint) | < 2.5s | Vercel Speed Insights / Lighthouse |
| CLS (Cumulative Layout Shift) | < 0.1 | Lighthouse — design system components must not shift layout on mount |
| INP (Interaction to Next Paint) | < 200ms | Lighthouse — Button click, Input keystroke, Modal open must all respond within 200ms |
| Modal open animation | < 150ms | `performance.now()` delta from trigger to fully-visible state |
| Toast mount + animate-in | < 100ms | `performance.now()` delta |
| Component initial render (vitest jsdom) | < 5ms per component | Measured via `performance.now()` in benchmark test |
| Theme switch re-render (all visible components) | < 50ms | `performance.now()` around `data-theme` attribute toggle |

Design system components are small primitives. Any component that takes > 5ms to render in jsdom has a structural problem (likely unnecessary memoization overhead, excess context reads, or synchronous DOM measurements).

### 9.2 Bundle Size Targets

| Target | Limit | Enforcement |
|--------|-------|-------------|
| Per-component gzipped size | < 5KB gzipped per component | `next experimental-analyze` on the component-only build |
| Full design system library (all primitives) | < 40KB gzipped | `next experimental-analyze` diff against baseline |
| No runtime CSS-in-JS | 0 bytes of style injection overhead at mount | ESLint rule against `style` prop with dynamic values in `components/ui/**` |

Tree-shaking is required: importing `Button` must not pull in `Modal` or `DatePicker`. Verify with `next experimental-analyze` — each component appears as a separate chunk.

### 9.3 Test Pipeline Performance

| Metric | Target | Baseline |
|--------|--------|----------|
| Per-component test suite (vitest) | < 500ms | Primitives: < 200ms, Containers: < 400ms |
| Full design system unit suite | < 30s | Not yet measured — establish baseline on first merge |
| Playwright visual regression job | < 3 minutes | Single chromium run of all `@visual` tests |
| Playwright accessibility job | < 2 minutes | Single chromium run of all axe audits |

Tests that consistently exceed these limits are candidates for refactoring (e.g. too many `userEvent.tab()` cycles, unnecessary re-renders between assertions).

### 9.4 Coverage Performance Gate

Coverage collection adds overhead to vitest runs. The design system test suite must not increase the full-suite coverage collection time by more than 10 seconds over the baseline measured before the first component merges.

---

## 10. Known Gaps and Risks

| Gap | Severity | Mitigation |
|-----|----------|------------|
| `jsdom` does not evaluate CSS cascade — computed color/contrast cannot be asserted in unit tests | Medium | Color contrast covered by axe-core E2E; CSS token presence covered by attribute assertions |
| jsdom CSS custom property inheritance is incomplete | Medium | Token presence asserted via DOM `style` attribute or `data-theme` attribute, not `getComputedStyle` |
| Visual regression baselines require a stable rendering environment | Medium | Pin CI container image; use font anti-aliasing flags; mask text regions if needed |
| Reduced motion detection requires `window.matchMedia` mock | Low | Pattern documented in section 4.2; mock is deterministic |
| Focus trap testing in jsdom is incomplete for complex scenarios | Medium | Focus trap behavior covered in Playwright E2E tests in addition to unit-level Tab assertions |
| `@testing-library/user-event` version compatibility with React 19 | Low | Current `@testing-library/react` 16.3.x ships with user-event compatibility for React 19; pin versions together |
| ThemeProvider not yet implemented | Blocker | The `componentTestUtils.tsx` render wrapper extension in section 2.4 is conditional — do not add the provider wrapper until `ThemeProvider` exists. Until then, tests run without the provider (acceptable for structural/interaction tests). |

---

## 11. Quick-Reference Checklist

Before marking a design system component ticket as done, verify all of the following.

**Tests written:**
- [ ] Unit tests cover all variants, sizes, disabled state, ref forwarding, className merging
- [ ] Unit tests cover all keyboard interactions
- [ ] Unit tests assert all ARIA attributes
- [ ] Unit tests cover dark and light themes
- [ ] Fake timer tests cover auto-dismiss (Feedback components)
- [ ] Focus management tested for containers

**Quality gates passing:**
- [ ] `cd web && npx eslint --max-warnings 0 .` — zero warnings
- [ ] `cd web && npx tsc --noEmit` — zero errors
- [ ] `cd web && npx vitest run` — all tests pass
- [ ] Coverage: statements 100%, branches 95%, functions 100%
- [ ] E2E axe-core test passes for this component

**Accessibility confirmed:**
- [ ] All ARIA roles and attributes present
- [ ] Keyboard navigation works end-to-end
- [ ] Icon-only variants have `aria-label`
- [ ] No hardcoded colors (ESLint passes)

**Visual regression:**
- [ ] Baseline snapshots committed for all variants
- [ ] CI visual regression job passes

**Documentation:**
- [ ] `data-testid` on root element
- [ ] Props documented with JSDoc
- [ ] Component added to `/dev/design-system` fixture page
