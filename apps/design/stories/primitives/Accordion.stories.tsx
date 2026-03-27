import type { Meta, StoryObj } from '@storybook/react';
import { Accordion } from '@spawnforge/ui';

const items = [
  { id: 'item1', title: 'What is SpawnForge?', content: <p>SpawnForge is an AI-native game engine for the browser.</p> },
  { id: 'item2', title: 'How does AI work?', content: <p>Describe what you want and the AI builds it using 350+ MCP commands.</p> },
  { id: 'item3', title: 'What platforms are supported?', content: <p>WebGPU and WebGL2, running in any modern browser.</p> },
];

const meta: Meta<typeof Accordion> = {
  title: 'Primitives/Accordion',
  component: Accordion,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Accordion>;

export const Default: Story = {
  args: { items },
};

export const WithDefaultOpen: Story = {
  args: { items, defaultOpen: 'item1' },
};
