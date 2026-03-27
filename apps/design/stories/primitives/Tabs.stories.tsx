import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Tabs } from '@spawnforge/ui';

const tabs = [
  { id: 'general', label: 'General', content: <div>General settings content</div> },
  { id: 'appearance', label: 'Appearance', content: <div>Appearance settings content</div> },
  { id: 'advanced', label: 'Advanced', content: <div>Advanced settings content</div> },
];

const meta: Meta<typeof Tabs> = {
  title: 'Primitives/Tabs',
  component: Tabs,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Tabs>;

export const Default: Story = {
  args: {
    tabs,
    activeTab: 'general',
    onChange: () => {},
  },
};

export const Interactive: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [active, setActive] = useState('general');
    return <Tabs tabs={tabs} activeTab={active} onChange={setActive} />;
  },
};
