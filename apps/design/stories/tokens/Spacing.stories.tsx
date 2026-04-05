import type { Meta, StoryObj } from '@storybook/react';
import { SPACING } from '@spawnforge/ui/tokens';

function SpacingScale() {
  return (
    <div className="p-6 font-sans">
      <h2 className="mb-4">Spacing Scale (4px grid)</h2>
      <div className="flex flex-col gap-3">
        {Object.entries(SPACING).map(([key, value]) => (
          <div
            key={key}
            className="flex items-center gap-4"
            style={{ '--w': value } as React.CSSProperties}
          >
            <div className="w-[80px] font-mono text-[13px]">
              SPACING.{key}
            </div>
            <div className="w-[50px] font-mono text-[13px] opacity-60">
              {value}
            </div>
            <div className="h-6 w-[var(--w)] rounded bg-[var(--sf-accent)] transition-[width] duration-200" />
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
