import type { Meta, StoryObj } from '@storybook/react';
import { Textarea } from '@spawnforge/ui';

const meta: Meta<typeof Textarea> = {
  title: 'Primitives/Textarea',
  component: Textarea,
  tags: ['autodocs'],
  argTypes: {
    disabled: { control: 'boolean' },
    error: { control: 'boolean' },
    placeholder: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  args: { placeholder: 'Write something...' },
};

export const WithError: Story = {
  args: { placeholder: 'Invalid content', error: true },
};

export const Disabled: Story = {
  args: { placeholder: 'Disabled', disabled: true },
};

export const WithValue: Story = {
  args: { defaultValue: 'Pre-filled text content\nWith multiple lines.' },
};
