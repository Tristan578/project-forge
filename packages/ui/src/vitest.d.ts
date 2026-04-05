import type { AxeResults } from 'axe-core';

interface JestAxeMatchers {
  toHaveNoViolations(): void;
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion extends JestAxeMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends JestAxeMatchers {}
}
