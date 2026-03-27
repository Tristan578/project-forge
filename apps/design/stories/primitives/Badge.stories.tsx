import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from '@spawnforge/ui';

const meta: Meta<typeof Badge> = {
  title: 'Primitives/Badge',
  component: Badge,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'success', 'warning', 'destructive'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = {
  args: { children: 'Default', variant: 'default' },
};

export const Success: Story = {
  args: { children: 'Active', variant: 'success' },
};

export const Warning: Story = {
  args: { children: 'Pending', variant: 'warning' },
};

export const Destructive: Story = {
  args: { children: 'Error', variant: 'destructive' },
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      <Badge variant="default">Default</Badge>
      <Badge variant="success">Success</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="destructive">Error</Badge>
    </div>
  ),
};
