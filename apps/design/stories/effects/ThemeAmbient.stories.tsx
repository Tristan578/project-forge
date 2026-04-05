import type { Meta, StoryObj, StoryFn } from '@storybook/react';
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

/** Helper: creates the effects-attribute decorator (theme is handled by preview via globals). */
function effectsDecorator(effects: 'on' | 'off') {
  return (Story: StoryFn) => {
    document.documentElement.setAttribute('data-sf-effects', effects);
    return <Story />;
  };
}

/** Helper: builds story config for a given theme + optional overrides. */
function themeStory(
  theme: ThemeName,
  effects: 'on' | 'off' = 'on',
  overrides?: Partial<Story>,
): Story {
  return {
    globals: { sfTheme: theme },
    decorators: [effectsDecorator(effects)],
    ...overrides,
  };
}

/** Helper: builds story config for a narrow (768px) viewport variant. */
function narrowStory(
  theme: ThemeName,
  name: string,
  effects: 'on' | 'off' = 'on',
): Story {
  return themeStory(theme, effects, {
    name,
    parameters: { viewport: { defaultViewport: 'ipad' } },
  });
}

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
export const Dark: Story = themeStory('dark');

/** Ember theme — radial-gradient pulse with floating sparks. */
export const Ember: Story = themeStory('ember');

/** Ice theme — SVG frost cracks growing across panel borders. */
export const Ice: Story = themeStory('ice');

/** Leaf theme — SVG leaves drifting upward from sidebar edges. */
export const Leaf: Story = themeStory('leaf');

/** Rust theme — small SVG gears rotating on panel dividers. */
export const Rust: Story = themeStory('rust');

/** Mech theme — scan line + HUD corner brackets. */
export const Mech: Story = themeStory('mech');

/** Light theme — warm radial glow at toolbar area. */
export const Light: Story = themeStory('light');

/** Effects disabled — no effect regardless of theme. */
export const EffectsOff: Story = themeStory('ember', 'off', {
  name: 'Effects Off (ember)',
});

/** Ember at narrow viewport — verifies overflow: hidden clips effects. */
export const EmberNarrow: Story = narrowStory('ember', 'Ember (768px)');

/** Ice at narrow viewport. */
export const IceNarrow: Story = narrowStory('ice', 'Ice (768px)');

/** Mech at narrow viewport — scan lines should still fill width. */
export const MechNarrow: Story = narrowStory('mech', 'Mech (768px)');

/** Effects off at narrow viewport — confirms no effect leakage. */
export const EffectsOffNarrow: Story = narrowStory('ember', 'Effects Off (768px)', 'off');

/** Dark at narrow viewport — baseline for no-effect rendering. */
export const DarkNarrow: Story = narrowStory('dark', 'Dark (768px)');
