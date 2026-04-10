import type { StorybookConfig } from '@storybook/react-vite';

const stories = [
  '../stories/primitives/**/*.stories.@(ts|tsx)',
  '../stories/composites/**/*.stories.@(ts|tsx)',
  '../stories/tokens/**/*.stories.@(ts|tsx)',
];

// Effects stories (Plan C)
stories.push('../stories/effects/**/*.stories.@(ts|tsx)');

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
  viteFinal: async (config) => {
    config.build = config.build || {};
    config.build.target = 'es2022';
    config.optimizeDeps = config.optimizeDeps || {};
    config.optimizeDeps.esbuildOptions = config.optimizeDeps.esbuildOptions || {};
    config.optimizeDeps.esbuildOptions.target = 'es2022';
    config.esbuild = config.esbuild || {};
    config.esbuild.target = 'es2022';
    return config;
  },
};

export default config;
