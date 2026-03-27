import type { Meta, StoryObj } from '@storybook/react';
import { Toast } from '@spawnforge/ui';

const meta: Meta<typeof Toast> = {
  title: 'Primitives/Toast',
  component: Toast,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['info', 'success', 'warning', 'error'] },
    message: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Toast>;

export const Info: Story = {
  args: { message: 'This is an informational message.', variant: 'info', duration: 0 },
};

export const Success: Story = {
  args: { message: 'Operation completed successfully!', variant: 'success', duration: 0 },
};

export const Warning: Story = {
  args: { message: 'This action may have side effects.', variant: 'warning', duration: 0 },
};

export const Error: Story = {
  args: { message: 'An error occurred. Please try again.', variant: 'error', duration: 0 },
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '400px' }}>
      <Toast message="Informational toast" variant="info" onDismiss={() => {}} duration={0} />
      <Toast message="Success toast" variant="success" onDismiss={() => {}} duration={0} />
      <Toast message="Warning toast" variant="warning" onDismiss={() => {}} duration={0} />
      <Toast message="Error toast" variant="error" onDismiss={() => {}} duration={0} />
    </div>
  ),
};
