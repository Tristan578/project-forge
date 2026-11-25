import type { Meta, StoryObj } from '@storybook/react';
import { useState, type ComponentProps } from 'react';
import { fn } from 'storybook/test';
import { NumberField } from '@spawnforge/ui';

function ControlledNumberField(args: ComponentProps<typeof NumberField>) {
  const [value, setValue] = useState(args.value);
  return (
    <div style={{ width: '20rem', maxWidth: '100%' }}>
      <NumberField
        {...args}
        value={value}
        onChange={(next) => {
          setValue(next);
          args.onChange(next);
        }}
      />
    </div>
  );
}

const meta: Meta<typeof NumberField> = {
  title: 'Composites/NumberField',
  component: NumberField,
  tags: ['autodocs'],
  args: { label: 'Distance', value: 5, step: 0.1, onChange: fn() },
  render: (args) => <ControlledNumberField key={args.value} {...args} />,
};

export default meta;
type Story = StoryObj<typeof NumberField>;

export const Default: Story = {};
export const Bounded: Story = { args: { min: 0, max: 10 } };
export const Disabled: Story = { args: { disabled: true } };
export const CustomId: Story = { args: { id: 'storybook-distance' } };
