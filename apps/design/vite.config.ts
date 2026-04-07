import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Vite config for Storybook.
// @vitejs/plugin-react is required to enable the automatic JSX runtime
// (react/jsx-runtime) so story files and preview.tsx can use JSX
// without importing React explicitly.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
  },
});
