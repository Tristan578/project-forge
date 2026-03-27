import type { Meta, StoryObj } from '@storybook/react';
import { Switch } from '@spawnforge/ui';

const meta: Meta<typeof Switch> = {
  title: 'Primitives/Switch',
  component: Switch,
  tags: ['autodocs'],
  argTypes: {
    disabled: { control: 'boolean' },
    checked: { control: 'boolean' },
    size: { control: 'select', options: ['sm', 'md'] },
  },
};

export default meta;
type Story = StoryObj<typeof Switch>;

export const Default: Story = {
  args: { label: 'Enable feature' },
};

export const Checked: Story = {
  args: { label: 'Active', defaultChecked: true },
};

export const Disabled: Story = {
  args: { label: 'Disabled', disabled: true },
};

export const Small: Story = {
  args: { label: 'Small toggle', size: 'sm' },
};

export const NoLabel: Story = {
  args: {},
};
