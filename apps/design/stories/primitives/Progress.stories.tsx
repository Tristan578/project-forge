import type { Meta, StoryObj } from '@storybook/react';
import { Progress } from '@spawnforge/ui';

const meta: Meta<typeof Progress> = {
  title: 'Primitives/Progress',
  component: Progress,
  tags: ['autodocs'],
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 100 } },
  },
};

export default meta;
type Story = StoryObj<typeof Progress>;

export const Default: Story = {
  args: { value: 60 },
};

export const Empty: Story = { args: { value: 0 } };
export const Full: Story = { args: { value: 100 } };

export const AllValues: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '300px' }}>
      {[0, 25, 50, 75, 100].map((v) => (
        <div key={v}>
          <div style={{ fontSize: '12px', marginBottom: '4px', color: 'var(--sf-text-muted)' }}>{v}%</div>
          <Progress value={v} />
        </div>
      ))}
    </div>
  ),
};
