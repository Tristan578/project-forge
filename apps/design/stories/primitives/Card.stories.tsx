import type { Meta, StoryObj } from '@storybook/react';
import { Card, Button } from '@spawnforge/ui';

const meta: Meta<typeof Card> = {
  title: 'Primitives/Card',
  component: Card,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  args: { children: 'Card content goes here.' },
};

export const WithTitle: Story = {
  args: { title: 'Card Title', children: 'Card content with a title header.' },
};

export const WithFooter: Story = {
  args: {
    title: 'Card Title',
    children: 'Card content.',
    footer: 'Last updated 2 hours ago',
  },
};

export const WithActions: Story = {
  render: () => (
    <Card
      title="Confirm Action"
      footer={
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="outline" size="sm">Cancel</Button>
          <Button variant="destructive" size="sm">Delete</Button>
        </div>
      }
    >
      Are you sure you want to delete this item?
    </Card>
  ),
};
