import type { Meta, StoryObj } from '@storybook/react';
import { Select } from '@spawnforge/ui';

const options = [
  { value: 'option1', label: 'Option 1' },
  { value: 'option2', label: 'Option 2' },
  { value: 'option3', label: 'Option 3' },
  { value: 'disabled', label: 'Disabled Option', disabled: true },
];

const meta: Meta<typeof Select> = {
  title: 'Primitives/Select',
  component: Select,
  tags: ['autodocs'],
  argTypes: {
    disabled: { control: 'boolean' },
    placeholder: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Select>;

export const Default: Story = {
  args: { options, placeholder: 'Select an option...' },
};

export const WithValue: Story = {
  args: { options, value: 'option2' },
};

export const Disabled: Story = {
  args: { options, disabled: true, placeholder: 'Disabled' },
};
