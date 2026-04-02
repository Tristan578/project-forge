// Augment Vitest 4.x Assertion type with @testing-library/jest-dom matchers.
// jest-dom 6.9.1 augments `declare module 'vitest'` but Vitest 4.x re-exports
// Assertion from '@vitest/expect'. Runtime setup is in vitest.setup.ts.
// NOTE: The triple-slash reference to @testing-library/jest-dom/vitest is omitted
// intentionally — it augments the old `vitest` module interface which is no longer
// where Vitest 4.x resolves Assertion. The explicit @vitest/expect augmentation
// below is the correct approach for Vitest 4.x.

import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module '@vitest/expect' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion<T = unknown>
    extends TestingLibraryMatchers<ReturnType<typeof expect.stringContaining>, T> {}
}
