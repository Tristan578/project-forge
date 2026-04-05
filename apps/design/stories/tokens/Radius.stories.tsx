import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { RADIUS } from '@spawnforge/ui/tokens';
import { DEMO_RADIUS } from './vars';

function RadiusReference() {
  return (
    <div className="p-6 font-sans">
      <h2 className="mb-6">Border Radius Tokens</h2>
      <div className="flex gap-6 flex-wrap">
        {Object.entries(RADIUS).map(([key, value]) => (
          <div
            key={key}
            className="text-center"
            style={{ [DEMO_RADIUS]: value } as CSSProperties}
          >
            <div className={`w-20 h-20 bg-[var(--sf-accent)] rounded-[var(${DEMO_RADIUS})] mb-2`} />
            <div className="font-mono text-xs">RADIUS.{key}</div>
            <div className="font-mono text-[11px] opacity-60">{value}</div>
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
