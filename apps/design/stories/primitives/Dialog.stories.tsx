import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Dialog, Button } from '@spawnforge/ui';

const meta: Meta<typeof Dialog> = {
  title: 'Primitives/Dialog',
  component: Dialog,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Dialog>;

export const Default: Story = {
  args: {
    open: true,
    title: 'Dialog Title',
    description: 'This is a description of what this dialog is about.',
    children: 'Dialog body content goes here.',
  },
};

export const WithActions: Story = {
  args: {
    open: true,
    title: 'Confirm Delete',
    description: 'This action cannot be undone.',
    actions: (
      <>
        <Button variant="outline" size="sm">Cancel</Button>
        <Button variant="destructive" size="sm">Delete</Button>
      </>
    ),
  },
};

export const Interactive: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [open, setOpen] = useState(false);
    return (
      <div>
        <Button onClick={() => setOpen(true)}>Open Dialog</Button>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="Interactive Dialog"
          description="Press Escape or click outside to close."
          actions={<Button onClick={() => setOpen(false)}>Close</Button>}
        >
          This dialog can be closed interactively.
        </Dialog>
      </div>
    );
  },
};
