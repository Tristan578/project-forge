import type { Meta, StoryObj } from '@storybook/react';
import { Avatar } from '@spawnforge/ui';

const meta: Meta<typeof Avatar> = {
  title: 'Primitives/Avatar',
  component: Avatar,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg', 'xl'] },
    name: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Avatar>;

export const Initials: Story = {
  args: { name: 'Tristan Nolan', size: 'md' },
};

export const AllSizes: Story = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <Avatar name="T N" size="sm" />
      <Avatar name="T N" size="md" />
      <Avatar name="T N" size="lg" />
      <Avatar name="T N" size="xl" />
    </div>
  ),
};
