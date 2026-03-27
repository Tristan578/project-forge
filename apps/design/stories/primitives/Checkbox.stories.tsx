import type { Meta, StoryObj } from '@storybook/react';
import { Checkbox } from '@spawnforge/ui';

const meta: Meta<typeof Checkbox> = {
  title: 'Primitives/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
  argTypes: {
    disabled: { control: 'boolean' },
    checked: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Checkbox>;

export const Default: Story = {
  args: { label: 'Accept terms and conditions' },
};

export const Checked: Story = {
  args: { label: 'Pre-checked', defaultChecked: true },
};

export const Disabled: Story = {
  args: { label: 'Disabled option', disabled: true },
};

export const NoLabel: Story = {
  args: {},
};
