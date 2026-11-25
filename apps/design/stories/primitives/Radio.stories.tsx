import type { Meta, StoryObj } from '@storybook/react';
import { Radio } from '@spawnforge/ui';

const meta: Meta<typeof Radio> = {
  title: 'Primitives/Radio',
  component: Radio,
  tags: ['autodocs'],
  argTypes: { disabled: { control: 'boolean' } },
};
export default meta;
type Story = StoryObj<typeof Radio>;

export const Default: Story = { args: { label: 'Win' } };
export const WithDescription: Story = {
  args: { label: 'Sandbox', description: 'A creative space with no goal.', defaultChecked: true },
};
export const Disabled: Story = { args: { label: 'Disabled option', disabled: true } };
export const Group: Story = {
  render: () => (
    <div role="radiogroup" aria-label="Completion mode" className="space-y-1">
      <Radio name="story-mode" label="Win" description="Reach a goal to finish." defaultChecked />
      <Radio name="story-mode" label="Sandbox" description="A creative space with no goal." />
      <Radio name="story-mode" label="Unavailable" disabled />
    </div>
  ),
};
