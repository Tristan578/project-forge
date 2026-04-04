import type { Meta, StoryObj } from '@storybook/react';
import { THEME_NAMES, THEME_DEFINITIONS, type ThemeName } from '@spawnforge/ui/tokens';

function ColorSwatch({ token, value }: { token: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '4px 0' }}>
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 6,
          backgroundColor: value,
          border: '1px solid rgba(128,128,128,0.3)',
          flexShrink: 0,
        }}
      />
      <div>
        <div style={{ fontFamily: 'monospace', fontSize: 13 }}>{token}</div>
        <div style={{ fontFamily: 'monospace', fontSize: 11, opacity: 0.6 }}>{value}</div>
      </div>
    </div>
  );
}

function ThemeColorGrid({ theme }: { theme: ThemeName }) {
  const tokens = THEME_DEFINITIONS[theme];
  const colorTokens = Object.entries(tokens).filter(([key]) =>
    key.startsWith('--sf-bg') ||
    key.startsWith('--sf-text') ||
    key.startsWith('--sf-border') ||
    key.startsWith('--sf-accent') ||
    key.startsWith('--sf-on-') ||
    key.startsWith('--sf-destructive') ||
    key.startsWith('--sf-success') ||
    key.startsWith('--sf-warning')
  );

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: '0 0 16px', fontFamily: 'system-ui' }}>
        {theme.charAt(0).toUpperCase() + theme.slice(1)} Theme
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
        {colorTokens.map(([token, value]) => (
          <ColorSwatch key={token} token={token} value={value} />
        ))}
      </div>
    </div>
  );
}

const meta: Meta = {
  title: 'Tokens/Colors',
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj;

export const AllThemes: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {THEME_NAMES.map((theme) => (
        <ThemeColorGrid key={theme} theme={theme} />
      ))}
    </div>
  ),
};

export const Dark: Story = { render: () => <ThemeColorGrid theme="dark" /> };
export const Light: Story = { render: () => <ThemeColorGrid theme="light" /> };
export const Ember: Story = { render: () => <ThemeColorGrid theme="ember" /> };
export const Ice: Story = { render: () => <ThemeColorGrid theme="ice" /> };
export const Leaf: Story = { render: () => <ThemeColorGrid theme="leaf" /> };
export const Rust: Story = { render: () => <ThemeColorGrid theme="rust" /> };
export const Mech: Story = { render: () => <ThemeColorGrid theme="mech" /> };
