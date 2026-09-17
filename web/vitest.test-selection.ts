/**
 * The production test partition. Keep this as the single source of truth for
 * both Vitest projects and the selection contract test.
 *
 * The root configuration historically selected every test under jsdom. The
 * Node project takes server/unit tests, while browser-facing component, hook,
 * and app tests retain jsdom. These lists deliberately include the standalone
 * script and e2e-library suites that workspace-only globs previously missed.
 */
export const ROOT_TEST_INCLUDE = [
  'src/**/*.test.ts',
  'src/**/*.test.tsx',
  'e2e/lib/__tests__/**/*.test.ts',
  'scripts/__tests__/**/*.test.ts',
] as const;

export const NODE_TEST_INCLUDE = [
  'src/lib/**/*.test.ts',
  'src/lib/**/*.test.tsx',
  'src/stores/**/*.test.ts',
  'src/stores/**/*.test.tsx',
  'src/data/**/*.test.ts',
  'src/data/**/*.test.tsx',
  'src/test/**/*.test.ts',
  'src/test/**/*.test.tsx',
  'src/app/api/**/*.test.ts',
  'src/app/api/**/*.test.tsx',
  'src/__integration__/**/*.test.ts',
  'src/__integration__/**/*.test.tsx',
  'src/__tests__/**/*.test.ts',
  'src/__tests__/**/*.test.tsx',
  'e2e/lib/__tests__/**/*.test.ts',
  'scripts/__tests__/**/*.test.ts',
] as const;

export const JSDOM_TEST_INCLUDE = [
  'src/components/**/*.test.ts',
  'src/components/**/*.test.tsx',
  'src/hooks/**/*.test.ts',
  'src/hooks/**/*.test.tsx',
  'src/app/**/*.test.ts',
  'src/app/**/*.test.tsx',
] as const;

// API route tests are server tests even though their files live under app/.
export const JSDOM_TEST_EXCLUDE = [
  'src/app/api/**/*.test.ts',
  'src/app/api/**/*.test.tsx',
] as const;
