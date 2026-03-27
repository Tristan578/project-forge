import type { Meta, StoryObj } from '@storybook/react';
import { ScrollArea } from '@spawnforge/ui';

const meta: Meta<typeof ScrollArea> = {
  title: 'Primitives/ScrollArea',
  component: ScrollArea,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof ScrollArea>;

export const Default: Story = {
  render: () => (
    <ScrollArea height="200px" style={{ width: '300px' }}>
      {Array.from({ length: 20 }, (_, i) => (
        <div key={i} style={{ padding: '8px 4px', borderBottom: '1px solid var(--sf-border)' }}>
          Item {i + 1}
        </div>
      ))}
    </ScrollArea>
  ),
};
