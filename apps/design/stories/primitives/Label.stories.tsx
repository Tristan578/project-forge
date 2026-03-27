import type { Meta, StoryObj } from '@storybook/react';
import { Label, Input } from '@spawnforge/ui';

const meta: Meta<typeof Label> = {
  title: 'Primitives/Label',
  component: Label,
  tags: ['autodocs'],
  argTypes: {
    required: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Label>;

export const Default: Story = {
  args: { children: 'Email Address' },
};

export const Required: Story = {
  args: { children: 'Name', required: true },
};

export const WithInput: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <Label htmlFor="email" required>Email</Label>
      <Input id="email" type="email" placeholder="you@example.com" />
    </div>
  ),
};
