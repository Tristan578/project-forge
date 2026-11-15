import type { Meta, StoryObj } from '@storybook/react';
import { InlineAlert } from '@spawnforge/ui';

const meta: Meta<typeof InlineAlert> = {
  title: 'Primitives/InlineAlert',
  component: InlineAlert,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['warning', 'error', 'info'] },
  },
};

export default meta;
type Story = StoryObj<typeof InlineAlert>;

export const Warning: Story = {
  args: {
    variant: 'warning',
    children: 'Using default humanoid bones. Paste your actual bone names to override.',
  },
};

export const Error: Story = {
  args: {
    variant: 'error',
    children: 'Engine initialization failed. Select Retry, or switch to WebGL2 mode.',
  },
};

export const Info: Story = {
  args: {
    variant: 'info',
    children: 'This capability runs on the platform key — no setup required.',
  },
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '400px' }}>
      <InlineAlert variant="warning">Warning: this action may have side effects.</InlineAlert>
      <InlineAlert variant="error">Error: the request could not be completed.</InlineAlert>
      <InlineAlert variant="info">Info: changes are saved automatically.</InlineAlert>
    </div>
  ),
};
