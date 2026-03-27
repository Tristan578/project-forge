# Plan B: Components + Storybook (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build 20 tier 1 primitives in `@spawnforge/ui`, verify Dark + Light with axe-core, deploy Storybook to `design.spawnforge.ai`, connect Chromatic for visual regression.

**Depends on:** Plan A complete (workspace, tokens, useTheme).

**Architecture:** Each primitive is a React component using `cn()` + semantic token classes. Components are rebuilt from scratch with tokens (not migrated as-is from `web/src/components/ui/`). Stories live in `apps/design/stories/primitives/`. All components parameterized-tested across 7 themes.

---

## Task B1: Scaffold apps/design Storybook project

**Files:**
- Create: `apps/design/package.json`
- Create: `apps/design/.storybook/main.ts`
- Create: `apps/design/.storybook/preview.ts`
- Create: `apps/design/stories/` directory

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p apps/design/.storybook apps/design/stories/{primitives,composites,tokens,effects,internal}
```

- [ ] **Step 2: Write apps/design/package.json**

```json
{
  "name": "@spawnforge/design",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build -o storybook-static"
  },
  "devDependencies": {
    "storybook": "^8.6",
    "@storybook/react": "^8.6",
    "@storybook/react-vite": "^8.6",
    "@storybook/addon-a11y": "^8.6",
    "@storybook/addon-essentials": "^8.6",
    "@storybook/test": "^8.6",
    "@spawnforge/ui": "*",
    "chromatic": "^11",
    "react": "^19",
    "react-dom": "^19"
  }
}
```

- [ ] **Step 3: Write .storybook/main.ts**

```ts
// apps/design/.storybook/main.ts
import type { StorybookConfig } from '@storybook/react-vite';

const stories = [
  '../stories/primitives/**/*.stories.@(ts|tsx)',
  '../stories/composites/**/*.stories.@(ts|tsx)',
  '../stories/tokens/**/*.stories.@(ts|tsx)',
];

// Effects stories added when effects ship (Plan C)
// Internal stories gated by env var
if (process.env.INCLUDE_INTERNAL === 'true') {
  stories.push('../stories/internal/**/*.stories.@(ts|tsx)');
}

const config: StorybookConfig = {
  stories,
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-a11y',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
};

export default config;
```

- [ ] **Step 4: Write .storybook/preview.ts**

```ts
// apps/design/.storybook/preview.ts
import type { Preview } from '@storybook/react';
import { THEME_NAMES, THEME_DEFINITIONS, type ThemeName } from '@spawnforge/ui';

// Import the theme CSS + token utilities (static import — NOT dynamic)
import '@spawnforge/ui/tokens/theme.css';

function applyTheme(theme: ThemeName) {
  const tokens = THEME_DEFINITIONS[theme];
  const root = document.documentElement;
  root.setAttribute('data-sf-theme', theme);
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(key, value as string);
  }
}

const preview: Preview = {
  globalTypes: {
    sfTheme: {
      name: 'Theme',
      description: 'SpawnForge theme',
      defaultValue: 'dark',
      toolbar: {
        icon: 'paintbrush',
        items: THEME_NAMES.map((t) => ({
          value: t,
          title: t.charAt(0).toUpperCase() + t.slice(1),
        })),
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = (context.globals.sfTheme || 'dark') as ThemeName;
      // Apply theme tokens synchronously — no async import, no FOUC
      applyTheme(theme);
      return (
        <div style={{ background: 'var(--sf-bg-app)', color: 'var(--sf-text)', padding: '1rem', minHeight: '100vh' }}>
          <Story />
        </div>
      );
    },
  ],
  parameters: {
    backgrounds: { disable: true },
    layout: 'centered',
  },
};

export default preview;
```

- [ ] **Step 5: Install dependencies**

```bash
cd "$(git rev-parse --show-toplevel)" && npm install
```

- [ ] **Step 6: Verify Storybook starts**

```bash
cd apps/design && npm run storybook
```

Expected: Storybook opens at `http://localhost:6006` with theme toolbar. No stories yet.

- [ ] **Step 7: Commit**

```bash
git add apps/design/
git commit -m "feat: scaffold Storybook project in apps/design with theme toolbar"
```

---

## Task B2: Build Button primitive (reference implementation)

> This is the reference primitive — establishes the pattern all 19 others follow.

**Files:**
- Create: `packages/ui/src/primitives/Button.tsx`
- Test: `packages/ui/src/primitives/__tests__/Button.test.tsx`
- Story: `apps/design/stories/primitives/Button.stories.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// packages/ui/src/primitives/__tests__/Button.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../Button';
import { THEME_NAMES } from '../../tokens';

describe('Button', () => {
  it('renders with children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).not.toBeNull();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is disabled when disabled prop is true', () => {
    render(<Button disabled>Click</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders different variants', () => {
    const { rerender } = render(<Button variant="destructive">Delete</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('sf-destructive');

    rerender(<Button variant="outline">Outline</Button>);
    expect(screen.getByRole('button').className).toContain('sf-border');
  });

  it('forwards ref', () => {
    const ref = vi.fn();
    render(<Button ref={ref}>Ref</Button>);
    expect(ref).toHaveBeenCalledWith(expect.any(HTMLButtonElement));
  });

  it.each(THEME_NAMES)('renders without error in %s theme', (theme) => {
    document.documentElement.setAttribute('data-sf-theme', theme);
    const { container } = render(<Button>Test</Button>);
    expect(container.querySelector('button')).not.toBeNull();
    // No hardcoded primitive classes leak
    const allClasses = Array.from(container.querySelectorAll('[class]'))
      .flatMap((el) => el.className.split(' '));
    const leaks = allClasses.filter((c) => /^(bg-zinc|text-zinc|border-zinc|bg-stone|text-stone|bg-slate|text-slate)/.test(c));
    expect(leaks, `Hardcoded primitives found: ${leaks.join(', ')}`).toHaveLength(0);
  });

  it('has no accessibility violations', async () => {
    // Basic ARIA check — full axe runs in Storybook
    render(<Button>Accessible</Button>);
    const btn = screen.getByRole('button');
    expect(btn.tagName).toBe('BUTTON');
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd packages/ui && npx vitest run src/primitives/__tests__/Button.test.tsx
```

Expected: FAIL — Button module not found.

- [ ] **Step 3: Implement Button**

```tsx
// packages/ui/src/primitives/Button.tsx
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../utils/cn';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

const variantStyles: Record<NonNullable<ButtonProps['variant']>, string> = {
  default: 'bg-[var(--sf-accent)] text-white hover:bg-[var(--sf-accent-hover)]',
  destructive: 'bg-[var(--sf-destructive)] sf-destructive text-white hover:opacity-90',
  outline: 'bg-transparent sf-border border-[var(--sf-border-width)] sf-text hover:bg-[var(--sf-bg-elevated)]',
  ghost: 'bg-transparent sf-text hover:bg-[var(--sf-bg-elevated)]',
};

const sizeStyles: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-10 px-6 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center font-medium',
          'rounded-[var(--sf-radius-md)]',
          'transition-colors duration-[var(--sf-transition)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]',
          'disabled:opacity-50 disabled:pointer-events-none',
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd packages/ui && npx vitest run src/primitives/__tests__/Button.test.tsx
```

Expected: All tests pass.

- [ ] **Step 5: Write Storybook story**

```tsx
// apps/design/stories/primitives/Button.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '@spawnforge/ui';

const meta: Meta<typeof Button> = {
  title: 'Primitives/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'outline', 'ghost'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = {
  args: { children: 'Button', variant: 'default', size: 'md' },
};

export const Destructive: Story = {
  args: { children: 'Delete', variant: 'destructive' },
};

export const Outline: Story = {
  args: { children: 'Outline', variant: 'outline' },
};

export const Ghost: Story = {
  args: { children: 'Ghost', variant: 'ghost' },
};

export const Small: Story = {
  args: { children: 'Small', size: 'sm' },
};

export const Large: Story = {
  args: { children: 'Large', size: 'lg' },
};

export const Disabled: Story = {
  args: { children: 'Disabled', disabled: true },
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      <Button variant="default">Default</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button disabled>Disabled</Button>
    </div>
  ),
};
```

- [ ] **Step 6: Export Button from package**

Add to `packages/ui/src/index.ts`:
```ts
export { Button, type ButtonProps } from './primitives/Button';
```

- [ ] **Step 7: Build, test, verify Storybook**

```bash
cd packages/ui && npm run build && npx vitest run
cd apps/design && npm run storybook
```

Verify Button renders in Storybook with theme switching.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/primitives/ apps/design/stories/primitives/Button.stories.tsx packages/ui/src/index.ts
git commit -m "feat: Button primitive with tests + Storybook story (reference implementation)"
```

---

## Task B3-B20: Remaining 19 primitives

> Each follows the exact same pattern as Button (Task B2): test file → implementation → story → export → commit. Listed with key design notes per component.

### Task B3: Input

**Props:** `type`, `placeholder`, `disabled`, `error` (boolean), `className`
**Key:** Error state shows `--sf-destructive` border. Uses `--sf-radius-md` and `--sf-border-width`.

### Task B4: Select

**Props:** `options`, `value`, `onChange`, `placeholder`, `disabled`
**Key:** Custom chevron icon. Dropdown styled with `--sf-bg-overlay`.

### Task B5: Checkbox

**Props:** `checked`, `onChange`, `disabled`, `label`
**Key:** Checked state uses `--sf-accent`. Accessible label association via `id`.

### Task B6: Switch (toggle)

**Props:** `checked`, `onChange`, `disabled`, `label`
**Key:** Distinct from Checkbox — track/thumb metaphor. Track uses `--sf-bg-elevated`, active uses `--sf-accent`.

### Task B7: Slider

**Props:** `min`, `max`, `step`, `value`, `onChange`, `disabled`
**Key:** Standalone range input. Track uses `--sf-bg-elevated`, thumb uses `--sf-accent`. Composed by SliderInput in tier 2.

### Task B8: Modal

**Props:** `open`, `onClose`, `title`, `children`, `footer`
**Key:** Uses `useDialogA11y`. Overlay uses `--sf-bg-app` at 80% opacity. Focus trap. `Escape` to close.

### Task B9: Dialog

**Props:** `open`, `onClose`, `title`, `description`, `actions`
**Key:** Smaller than Modal — for confirmations. `role="alertdialog"` for destructive actions.

### Task B10: Popover

**Props:** `trigger`, `content`, `align`, `side`
**Key:** Non-modal overlay for context menus and dropdowns. `--sf-bg-overlay` background. Dismiss on outside click.

### Task B11: Card

**Props:** `title`, `children`, `footer`, `className`
**Key:** Surface container. Uses `--sf-bg-surface`, `--sf-border`, `--sf-radius-lg`.

### Task B12: Tabs

**Props:** `tabs` (array of `{id, label, content}`), `activeTab`, `onChange`
**Key:** Active tab indicator uses `--sf-accent`. Keyboard arrow navigation.

### Task B13: Tooltip

**Props:** `content`, `children`, `side`, `delay`
**Key:** z-index from `Z_INDEX.tooltips` (60). `--sf-bg-overlay` background. Delay default 300ms.

### Task B14: EmptyState (rebuild)

**Props:** `icon`, `title`, `description`, `action`
**Key:** Rebuild from existing `web/src/components/ui/EmptyState.tsx` with tokens instead of hardcoded zinc. Dashed border uses `--sf-border`.

### Task B15: Badge

**Props:** `variant` (`default` | `success` | `warning` | `destructive`), `children`
**Key:** Each variant maps to semantic accent tokens.

### Task B16: Spinner

**Props:** `size` (`sm` | `md` | `lg`)
**Key:** CSS animation `@keyframes spin`. Uses `--sf-accent` for color.

### Task B17: Skeleton

**Props:** `width`, `height`, `className`
**Key:** Loading placeholder. Animated shimmer using `--sf-bg-elevated` → `--sf-bg-overlay` gradient.

### Task B18: Toast

**Props:** `message`, `variant` (`info` | `success` | `warning` | `error`), `onDismiss`, `duration`
**Key:** z-index from `Z_INDEX.toasts` (70). Auto-dismiss timer. Stacks vertically.

### Task B19: Alert

**Props:** `variant` (`info` | `success` | `warning` | `error`), `title`, `children`, `onDismiss`
**Key:** Non-modal banner. Inline, not overlay. Icon per variant.

### Task B20: Separator

**Props:** `orientation` (`horizontal` | `vertical`), `className`
**Key:** Uses `--sf-border` color. 1px by default, respects `--sf-border-width` in Rust/Mech themes.

---

**For each of B3-B20:** Follow the B2 pattern exactly:
1. Write failing test (parameterized across 7 themes + primitives leak check)
2. Implement component with tokens
3. Write Storybook story with all variants
4. Export from `packages/ui/src/index.ts`
5. Build + test
6. Commit (one commit per component)

---

## Task B21: Token reference stories

**Files:**
- Create: `apps/design/stories/tokens/Colors.stories.tsx`
- Create: `apps/design/stories/tokens/Spacing.stories.tsx`
- Create: `apps/design/stories/tokens/Typography.stories.tsx`

- [ ] **Step 1: Write color palette story**

```tsx
// apps/design/stories/tokens/Colors.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { THEME_DEFINITIONS, THEME_NAMES } from '@spawnforge/ui';

const ColorPalette = () => {
  const tokenKeys = Object.keys(THEME_DEFINITIONS.dark).filter(k => k.startsWith('--sf-bg') || k.startsWith('--sf-text') || k.startsWith('--sf-border') || k.startsWith('--sf-accent') || k.startsWith('--sf-destructive') || k.startsWith('--sf-success') || k.startsWith('--sf-warning'));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
      {tokenKeys.map((key) => (
        <div
          key={key}
          style={{
            background: `var(${key})`,
            border: '1px solid var(--sf-border)',
            borderRadius: 'var(--sf-radius-md)',
            padding: '16px',
          }}
        >
          <code style={{ fontSize: '11px', color: 'var(--sf-text-muted)' }}>{key}</code>
        </div>
      ))}
    </div>
  );
};

const meta: Meta = {
  title: 'Tokens/Colors',
  component: ColorPalette,
};

export default meta;

export const Palette: StoryObj = {};
```

- [ ] **Step 2: Write spacing + typography stories** (similar pattern)

- [ ] **Step 3: Commit**

```bash
git add apps/design/stories/tokens/
git commit -m "feat: token reference stories (colors, spacing, typography)"
```

---

## Task B22: Chromatic setup + CI integration

**Files:**
- Modify: `.github/workflows/quality-gates.yml`

- [ ] **Step 1: Create Chromatic project**

1. Go to https://www.chromatic.com/start
2. Sign in with GitHub
3. Create project → select `Tristan578/project-forge`
4. Copy the project token

- [ ] **Step 2: Add Chromatic token to GitHub secrets**

```bash
gh secret set CHROMATIC_PROJECT_TOKEN
# Paste the token from Step 1
```

- [ ] **Step 3: Add Chromatic CI job to quality-gates.yml**

```yaml
  chromatic:
    name: Visual Regression (Chromatic)
    runs-on: ubuntu-latest
    needs: [lint, typescript]
    if: ${{ github.event_name == 'pull_request' }}
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v6
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: package-lock.json

      - run: npm ci

      - name: Build @spawnforge/ui
        run: cd packages/ui && npm run build

      - name: Run Chromatic
        uses: chromaui/action@v11
        with:
          projectToken: ${{ secrets.CHROMATIC_PROJECT_TOKEN }}
          workingDir: apps/design
          exitZeroOnChanges: true
          exitOnceUploaded: true
```

- [ ] **Step 4: Add build-storybook to CI**

Add to the existing quality gate jobs:
```yaml
  storybook-build:
    name: Storybook Build
    runs-on: ubuntu-latest
    needs: [lint, typescript]
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v6
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: package-lock.json
      - run: npm ci
      - run: cd packages/ui && npm run build
      - run: cd apps/design && npm run build-storybook
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/quality-gates.yml
git commit -m "ci: add Chromatic visual regression + Storybook build to quality gates"
```

---

## Task B23: Deploy Storybook to design.spawnforge.ai

**Prerequisite:** User has added Cloudflare CNAME `design` → `cname.vercel-dns.com` (grey cloud).

- [ ] **Step 1: Create Vercel project**

```bash
cd apps/design
vercel link
# Select: Create new project
# Project name: spawnforge-design
# Root directory: apps/design
# Build command: npm run build-storybook
# Output directory: storybook-static
```

- [ ] **Step 2: Add custom domain**

```bash
vercel domains add design.spawnforge.ai
```

- [ ] **Step 3: Configure build settings**

In Vercel Dashboard → spawnforge-design → Settings:
- Root Directory: `apps/design`
- Build Command: `cd ../.. && npm ci && cd packages/ui && npm run build && cd ../../apps/design && npm run build-storybook`
- Output Directory: `storybook-static`
- Install Command: (leave empty — handled in build command)

- [ ] **Step 4: Deploy**

```bash
vercel --prod
```

- [ ] **Step 5: Verify**

Visit `https://design.spawnforge.ai` — Storybook loads with all primitives and theme toolbar.

- [ ] **Step 6: Commit any config changes**

```bash
git add apps/design/
git commit -m "feat: deploy Storybook to design.spawnforge.ai"
```

---

## Task B24: axe-core verification for Dark + Light themes

- [ ] **Step 1: Run axe on every primitive story in Dark theme**

The `@storybook/addon-a11y` panel in Storybook shows axe results per story. Verify:
- Zero critical violations
- Zero serious violations
- Document any moderate violations as known issues

- [ ] **Step 2: Switch to Light theme and repeat**

- [ ] **Step 3: Fix any violations found**

Common fixes: missing `aria-label`, insufficient contrast, missing focus indicators.

- [ ] **Step 4: Commit fixes**

---

**Plan B complete.** Deliverables: 20 primitives with tests + stories, Storybook deployed, Chromatic connected, axe clean for Dark + Light.
