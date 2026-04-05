import type { Meta, StoryObj } from '@storybook/react';
import { ThemeAmbient, type ThemeName } from '@spawnforge/ui';

/**
 * ThemeAmbient renders a CSS-only ambient effect overlay for non-dark themes.
 *
 * Rules:
 * - Dark theme → no effect
 * - data-sf-effects="off" → no effect
 * - prefers-reduced-motion: reduce → no effect
 * - All other themes → lazy-loaded effect component
 *
 * The effect is absolutely positioned, pointer-events: none, z-index: 5.
 */
const meta: Meta<typeof ThemeAmbient> = {
  title: 'Effects/ThemeAmbient',
  component: ThemeAmbient,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'CSS-only ambient effect router. Reads `data-sf-theme` from `document.documentElement` and renders the matching effect. Import with `next/dynamic({ ssr: false })` to avoid hydration mismatch.',
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = (context.globals.sfTheme || 'dark') as ThemeName;
      // Apply data-sf-effects so ThemeAmbient can read it
      document.documentElement.setAttribute('data-sf-effects', 'on');
      return (
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100vh',
            background: 'var(--sf-bg-app)',
            color: 'var(--sf-text)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'system-ui, sans-serif',
            overflow: 'hidden',
          }}
        >
          {/* Mock editor chrome */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '40px',
              background: 'var(--sf-bg-surface)',
              borderBottom: '1px solid var(--sf-border)',
              display: 'flex',
              alignItems: 'center',
              paddingLeft: '1rem',
              gap: '0.5rem',
              fontSize: '12px',
              color: 'var(--sf-text-muted)',
            }}
          >
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#eab308', display: 'inline-block' }} />
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
            <span style={{ marginLeft: '0.5rem' }}>SpawnForge — {theme} theme</span>
          </div>
          {/* Mock sidebar */}
          <div
            style={{
              position: 'absolute',
              top: '40px',
              left: 0,
              bottom: 0,
              width: '200px',
              background: 'var(--sf-bg-surface)',
              borderRight: '1px solid var(--sf-border)',
            }}
          />
          {/* Mock canvas area label */}
          <div style={{ color: 'var(--sf-text-muted)', fontSize: '14px', zIndex: 10 }}>
            Canvas area — ambient effect renders behind this
          </div>
          {/* The effect overlay */}
          <Story />
        </div>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof ThemeAmbient>;

/** Dark theme — no effect rendered (null). */
export const Dark: Story = {
  decorators: [
    (Story) => {
      document.documentElement.setAttribute('data-sf-theme', 'dark');
      document.documentElement.setAttribute('data-sf-effects', 'on');
      return <Story />;
    },
  ],
};

/** Ember theme — radial-gradient pulse with floating sparks. */
export const Ember: Story = {
  decorators: [
    (Story) => {
      document.documentElement.setAttribute('data-sf-theme', 'ember');
      document.documentElement.setAttribute('data-sf-effects', 'on');
      return <Story />;
    },
  ],
};

/** Ice theme — SVG frost cracks growing across panel borders. */
export const Ice: Story = {
  decorators: [
    (Story) => {
      document.documentElement.setAttribute('data-sf-theme', 'ice');
      document.documentElement.setAttribute('data-sf-effects', 'on');
      return <Story />;
    },
  ],
};

/** Leaf theme — SVG leaves drifting upward from sidebar edges. */
export const Leaf: Story = {
  decorators: [
    (Story) => {
      document.documentElement.setAttribute('data-sf-theme', 'leaf');
      document.documentElement.setAttribute('data-sf-effects', 'on');
      return <Story />;
    },
  ],
};

/** Rust theme — small SVG gears rotating on panel dividers. */
export const Rust: Story = {
  decorators: [
    (Story) => {
      document.documentElement.setAttribute('data-sf-theme', 'rust');
      document.documentElement.setAttribute('data-sf-effects', 'on');
      return <Story />;
    },
  ],
};

/** Mech theme — scan line + HUD corner brackets. */
export const Mech: Story = {
  decorators: [
    (Story) => {
      document.documentElement.setAttribute('data-sf-theme', 'mech');
      document.documentElement.setAttribute('data-sf-effects', 'on');
      return <Story />;
    },
  ],
};

/** Light theme — warm radial glow at toolbar area. */
export const Light: Story = {
  decorators: [
    (Story) => {
      document.documentElement.setAttribute('data-sf-theme', 'light');
      document.documentElement.setAttribute('data-sf-effects', 'on');
      return <Story />;
    },
  ],
};

/** Effects disabled — no effect regardless of theme. */
export const EffectsOff: Story = {
  name: 'Effects Off (ember)',
  decorators: [
    (Story) => {
      document.documentElement.setAttribute('data-sf-theme', 'ember');
      document.documentElement.setAttribute('data-sf-effects', 'off');
      return <Story />;
    },
  ],
};

/** Ember at narrow viewport — verifies overflow: hidden clips effects. */
export const EmberNarrow: Story = {
  name: 'Ember (768px)',
  parameters: { viewport: { defaultViewport: 'ipad' } },
  decorators: [
    (Story) => {
      document.documentElement.setAttribute('data-sf-theme', 'ember');
      document.documentElement.setAttribute('data-sf-effects', 'on');
      return <Story />;
    },
  ],
};

/** Ice at narrow viewport. */
export const IceNarrow: Story = {
  name: 'Ice (768px)',
  parameters: { viewport: { defaultViewport: 'ipad' } },
  decorators: [
    (Story) => {
      document.documentElement.setAttribute('data-sf-theme', 'ice');
      document.documentElement.setAttribute('data-sf-effects', 'on');
      return <Story />;
    },
  ],
};

/** Mech at narrow viewport — scan lines should still fill width. */
export const MechNarrow: Story = {
  name: 'Mech (768px)',
  parameters: { viewport: { defaultViewport: 'ipad' } },
  decorators: [
    (Story) => {
      document.documentElement.setAttribute('data-sf-theme', 'mech');
      document.documentElement.setAttribute('data-sf-effects', 'on');
      return <Story />;
    },
  ],
};

/** Effects off at narrow viewport — confirms no effect leakage. */
export const EffectsOffNarrow: Story = {
  name: 'Effects Off (768px)',
  parameters: { viewport: { defaultViewport: 'ipad' } },
  decorators: [
    (Story) => {
      document.documentElement.setAttribute('data-sf-theme', 'ember');
      document.documentElement.setAttribute('data-sf-effects', 'off');
      return <Story />;
    },
  ],
};

/** Dark at narrow viewport — baseline for no-effect rendering. */
export const DarkNarrow: Story = {
  name: 'Dark (768px)',
  parameters: { viewport: { defaultViewport: 'ipad' } },
  decorators: [
    (Story) => {
      document.documentElement.setAttribute('data-sf-theme', 'dark');
      document.documentElement.setAttribute('data-sf-effects', 'on');
      return <Story />;
    },
  ],
};
