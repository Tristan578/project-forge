import type { Meta, StoryObj } from '@storybook/react';
import { Skeleton } from '@spawnforge/ui';

const meta: Meta<typeof Skeleton> = {
  title: 'Primitives/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Skeleton>;

export const Default: Story = {
  args: { width: '200px', height: '20px' },
};

export const CardSkeleton: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '300px' }}>
      <Skeleton height="160px" />
      <Skeleton height="20px" width="80%" />
      <Skeleton height="16px" width="60%" />
      <Skeleton height="16px" width="40%" />
    </div>
  ),
};

export const ListSkeleton: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '300px' }}>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Skeleton width="40px" height="40px" style={{ borderRadius: '50%' }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <Skeleton height="14px" />
            <Skeleton height="12px" width="70%" />
          </div>
        </div>
      ))}
    </div>
  ),
};
