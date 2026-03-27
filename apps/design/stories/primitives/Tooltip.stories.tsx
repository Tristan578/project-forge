import type { Meta, StoryObj } from '@storybook/react';
import { Tooltip, Button } from '@spawnforge/ui';

const meta: Meta<typeof Tooltip> = {
  title: 'Primitives/Tooltip',
  component: Tooltip,
  tags: ['autodocs'],
  argTypes: {
    side: { control: 'select', options: ['top', 'bottom', 'left', 'right'] },
    content: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const Default: Story = {
  args: {
    content: 'This is a tooltip',
    side: 'top',
    children: <Button>Hover me</Button>,
  },
};

export const AllSides: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px', padding: '32px' }}>
      <Tooltip content="Top tooltip" side="top"><Button>Top</Button></Tooltip>
      <Tooltip content="Bottom tooltip" side="bottom"><Button>Bottom</Button></Tooltip>
      <Tooltip content="Left tooltip" side="left"><Button>Left</Button></Tooltip>
      <Tooltip content="Right tooltip" side="right"><Button>Right</Button></Tooltip>
    </div>
  ),
};
