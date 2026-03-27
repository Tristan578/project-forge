import type { Meta, StoryObj } from '@storybook/react';
import { Input } from '@spawnforge/ui';

const meta: Meta<typeof Input> = {
  title: 'Primitives/Input',
  component: Input,
  tags: ['autodocs'],
  argTypes: {
    disabled: { control: 'boolean' },
    error: { control: 'boolean' },
    placeholder: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: { placeholder: 'Enter text...' },
};

export const WithError: Story = {
  args: { placeholder: 'Invalid value', error: true },
};

export const Disabled: Story = {
  args: { placeholder: 'Disabled', disabled: true },
};

export const WithValue: Story = {
  args: { defaultValue: 'Filled value' },
};
