import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { THEME_NAMES, THEME_DEFINITIONS, type ThemeName } from '@spawnforge/ui/tokens';
import { DEMO_BG } from './vars';

function ColorSwatch({ token, value }: { token: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div
        className={`w-10 h-10 rounded-md border border-[var(--sf-border)] shrink-0 bg-[var(${DEMO_BG})]`}
        style={{ [DEMO_BG]: value } as CSSProperties}
      />
      <div>
        <div className="font-mono text-[13px]">{token}</div>
        <div className="font-mono text-[11px] opacity-60">{value}</div>
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
    <div className="p-6">
      <h2 className="mb-4 font-sans">
        {theme.charAt(0).toUpperCase() + theme.slice(1)} Theme
      </h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2">
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
    <div className="flex flex-col gap-8">
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
