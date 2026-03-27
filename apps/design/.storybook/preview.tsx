import type { Preview } from '@storybook/react';
import { THEME_NAMES, THEME_DEFINITIONS, type ThemeName } from '@spawnforge/ui';

// Import the theme CSS + token utilities (static import — NOT dynamic)
import '@spawnforge/ui/tokens/theme.css';

function applyTheme(theme: ThemeName) {
  const tokens = THEME_DEFINITIONS[theme];
  const root = document.documentElement;
  root.setAttribute('data-sf-theme', theme);
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(key, value as string);
  }
}

const preview: Preview = {
  globalTypes: {
    sfTheme: {
      name: 'Theme',
      description: 'SpawnForge theme',
      defaultValue: 'dark',
      toolbar: {
        icon: 'paintbrush',
        items: THEME_NAMES.map((t) => ({
          value: t,
          title: t.charAt(0).toUpperCase() + t.slice(1),
        })),
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = (context.globals.sfTheme || 'dark') as ThemeName;
      // Apply theme tokens synchronously — no async import, no FOUC
      applyTheme(theme);
      return (
        <div style={{ background: 'var(--sf-bg-app)', color: 'var(--sf-text)', padding: '1rem', minHeight: '100vh' }}>
          <Story />
        </div>
      );
    },
  ],
  parameters: {
    backgrounds: { disable: true },
    layout: 'centered',
  },
};

export default preview;
