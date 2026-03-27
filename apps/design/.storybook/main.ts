import type { StorybookConfig } from '@storybook/react-vite';

const stories = [
  '../stories/primitives/**/*.stories.@(ts|tsx)',
  '../stories/composites/**/*.stories.@(ts|tsx)',
  '../stories/tokens/**/*.stories.@(ts|tsx)',
];

// Effects stories added when effects ship (Plan C)
// Internal stories gated by env var
if (process.env.INCLUDE_INTERNAL === 'true') {
  stories.push('../stories/internal/**/*.stories.@(ts|tsx)');
}

const config: StorybookConfig = {
  stories,
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-a11y',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
};

export default config;
