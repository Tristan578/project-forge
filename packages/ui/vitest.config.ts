import { defineConfig } from 'vitest/config';

// This suite runs per-PR in ci.yml's design-internal-gate (PF-1003).
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
