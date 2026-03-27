import type { Meta, StoryObj } from '@storybook/react';
import { Popover, Button } from '@spawnforge/ui';

const meta: Meta<typeof Popover> = {
  title: 'Primitives/Popover',
  component: Popover,
  tags: ['autodocs'],
  argTypes: {
    align: { control: 'select', options: ['start', 'center', 'end'] },
    side: { control: 'select', options: ['top', 'bottom', 'left', 'right'] },
  },
};

export default meta;
type Story = StoryObj<typeof Popover>;

export const Default: Story = {
  args: {
    trigger: <Button variant="outline">Open Popover</Button>,
    content: <div style={{ padding: '8px' }}>Popover content here</div>,
  },
};

export const WithMenu: Story = {
  render: () => (
    <Popover
      trigger={<Button variant="outline">Options</Button>}
      content={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '120px' }}>
          <button style={{ padding: '4px 8px', textAlign: 'left' }}>Edit</button>
          <button style={{ padding: '4px 8px', textAlign: 'left' }}>Duplicate</button>
          <button style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--sf-destructive)' }}>Delete</button>
        </div>
      }
    />
  ),
};
