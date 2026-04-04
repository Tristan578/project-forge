import type { Meta, StoryObj } from '@storybook/react';
import { SPACING } from '@spawnforge/ui/tokens';

function SpacingScale() {
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h2 style={{ margin: '0 0 16px' }}>Spacing Scale (4px grid)</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Object.entries(SPACING).map(([key, value]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 80, fontFamily: 'monospace', fontSize: 13 }}>
              SPACING.{key}
            </div>
            <div style={{ width: 50, fontFamily: 'monospace', fontSize: 13, opacity: 0.6 }}>
              {value}
            </div>
            <div
              style={{
                height: 24,
                width: value,
                backgroundColor: 'var(--sf-accent, #3b82f6)',
                borderRadius: 4,
                transition: 'width 200ms',
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

const meta: Meta = {
  title: 'Tokens/Spacing',
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj;

export const Scale: Story = {
  render: () => <SpacingScale />,
};
