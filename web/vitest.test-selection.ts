/**
 * The production test partition. Keep this as the single source of truth for
 * both Vitest projects and the selection contract test.
 *
 * The root configuration historically selected every test under jsdom. The
 * Node project takes server/unit tests, while browser-facing component, hook,
 * and app tests retain jsdom. These lists deliberately include the standalone
 * script and e2e-library suites that workspace-only globs previously missed.
 */
/** The legacy root selection that production coverage must preserve exactly. */
export const ROOT_TEST_INCLUDE = [
  'src/**/*.test.ts',
  'src/**/*.test.tsx',
  'e2e/lib/__tests__/**/*.test.ts',
  'scripts/__tests__/**/*.test.ts',
] as const;

/** Server, utility, integration, and standalone-test paths that do not need a DOM. */
export const NODE_TEST_INCLUDE = [
  'src/lib/**/*.test.ts',
  'src/lib/**/*.test.tsx',
  'src/stores/**/*.test.ts',
  'src/stores/**/*.test.tsx',
  'src/data/**/*.test.ts',
  'src/data/**/*.test.tsx',
  'src/test/**/*.test.ts',
  'src/test/**/*.test.tsx',
  'src/app/__tests__/**/*.test.ts',
  'src/app/__tests__/**/*.test.tsx',
  'src/app/api/**/*.test.ts',
  'src/app/api/**/*.test.tsx',
  'src/__integration__/**/*.test.ts',
  'src/__integration__/**/*.test.tsx',
  'src/__tests__/**/*.test.ts',
  'src/__tests__/**/*.test.tsx',
  'e2e/lib/__tests__/**/*.test.ts',
  'scripts/__tests__/**/*.test.ts',
] as const;

/** Browser APIs used by a small number of otherwise server-side test paths. */
export const NODE_TEST_EXCLUDE = [
  'src/lib/storage/__tests__/safeLocalStorage.test.ts',
  'src/stores/slices/__tests__/sceneSlice.test.ts',
] as const;

/** Browser-facing paths whose default project environment is jsdom. */
export const JSDOM_TEST_INCLUDE = [
  'src/components/**/*.test.ts',
  'src/components/**/*.test.tsx',
  'src/hooks/**/*.test.ts',
  'src/hooks/**/*.test.tsx',
  'src/app/**/*.test.ts',
  'src/app/**/*.test.tsx',
  'src/lib/storage/__tests__/safeLocalStorage.test.ts',
  'src/stores/slices/__tests__/sceneSlice.test.ts',
] as const;

/** API and top-level metadata/server suites are Node tests under app/. */
export const JSDOM_TEST_EXCLUDE = [
  'src/app/api/**/*.test.ts',
  'src/app/api/**/*.test.tsx',
] as const;
