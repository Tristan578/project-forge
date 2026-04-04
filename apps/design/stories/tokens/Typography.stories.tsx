import type { Meta, StoryObj } from '@storybook/react';
import { FONT_FAMILY, FONT_SIZE, FONT_WEIGHT } from '@spawnforge/ui/tokens';

function TypographyReference() {
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h2 style={{ margin: '0 0 24px' }}>Typography Tokens</h2>

      <section style={{ marginBottom: 32 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, textTransform: 'uppercase', opacity: 0.6 }}>
          Font Families
        </h3>
        {Object.entries(FONT_FAMILY).map(([key, value]) => (
          <div key={key} style={{ marginBottom: 12 }}>
            <div style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.5, marginBottom: 4 }}>
              FONT_FAMILY.{key}
            </div>
            <div style={{ fontFamily: value, fontSize: 18 }}>
              The quick brown fox jumps over the lazy dog
            </div>
          </div>
        ))}
      </section>

      <section style={{ marginBottom: 32 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, textTransform: 'uppercase', opacity: 0.6 }}>
          Font Sizes
        </h3>
        {Object.entries(FONT_SIZE).map(([key, value]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 8 }}>
            <div style={{ width: 100, fontFamily: 'monospace', fontSize: 12, opacity: 0.5 }}>
              FONT_SIZE.{key}
            </div>
            <div style={{ width: 60, fontFamily: 'monospace', fontSize: 12, opacity: 0.5 }}>
              {value}
            </div>
            <div style={{ fontSize: value }}>
              Sample text at {key}
            </div>
          </div>
        ))}
      </section>

      <section>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, textTransform: 'uppercase', opacity: 0.6 }}>
          Font Weights
        </h3>
        {Object.entries(FONT_WEIGHT).map(([key, value]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 8 }}>
            <div style={{ width: 100, fontFamily: 'monospace', fontSize: 12, opacity: 0.5 }}>
              FONT_WEIGHT.{key}
            </div>
            <div style={{ width: 40, fontFamily: 'monospace', fontSize: 12, opacity: 0.5 }}>
              {value}
            </div>
            <div style={{ fontWeight: Number(value), fontSize: 18 }}>
              Sample text at {key} weight
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

const meta: Meta = {
  title: 'Tokens/Typography',
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj;

export const Reference: Story = {
  render: () => <TypographyReference />,
};
