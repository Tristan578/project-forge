import { defineConfig } from 'vitest/config';

// Standalone config for the infra Worker's pure-logic tests. The Worker lives
// outside web/src (Cloudflare runtime, no web/Next deps), so it is NOT covered
// by web/vitest.config.node.ts. This config has no setup files and no jsdom — it
// just runs the .test.mjs suites in a node environment.
export default defineConfig({
  test: {
    name: 'asset-postprocess',
    environment: 'node',
    include: ['**/*.test.mjs'],
  },
});
