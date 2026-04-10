import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '@spawnforge/ui';

const meta: Meta<typeof Button> = {
  title: 'Primitives/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'outline', 'ghost'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = {
  args: { children: 'Button', variant: 'default', size: 'md' },
};

export const Destructive: Story = {
  args: { children: 'Delete', variant: 'destructive' },
};

export const Outline: Story = {
  args: { children: 'Outline', variant: 'outline' },
};

export const Ghost: Story = {
  args: { children: 'Ghost', variant: 'ghost' },
};

export const Small: Story = {
  args: { children: 'Small', size: 'sm' },
};

export const Large: Story = {
  args: { children: 'Large', size: 'lg' },
};

export const Disabled: Story = {
  args: { children: 'Disabled', disabled: true },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button variant="default">Default</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button disabled>Disabled</Button>
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
        <Button size="lg">Large</Button>
      </div>
    </div>
  ),
};
