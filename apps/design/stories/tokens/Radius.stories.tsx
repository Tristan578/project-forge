import type { Meta, StoryObj } from '@storybook/react';
import { RADIUS } from '@spawnforge/ui/tokens';

function RadiusReference() {
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h2 style={{ margin: '0 0 24px' }}>Border Radius Tokens</h2>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {Object.entries(RADIUS).map(([key, value]) => (
          <div key={key} style={{ textAlign: 'center' }}>
            <div
              style={{
                width: 80,
                height: 80,
                backgroundColor: 'var(--sf-accent, #3b82f6)',
                borderRadius: value,
                marginBottom: 8,
              }}
            />
            <div style={{ fontFamily: 'monospace', fontSize: 12 }}>RADIUS.{key}</div>
            <div style={{ fontFamily: 'monospace', fontSize: 11, opacity: 0.6 }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const meta: Meta = {
  title: 'Tokens/Radius',
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj;

export const Reference: Story = {
  render: () => <RadiusReference />,
};
