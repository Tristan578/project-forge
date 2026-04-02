// Augment Vitest 4.x Assertion type with @testing-library/jest-dom matchers.
// jest-dom 6.9.1 augments `declare module 'vitest'` but Vitest 4.x re-exports
// Assertion from '@vitest/expect'. This triple-slash reference ensures the
// augmentation is picked up by tsc.
/// <reference types="@testing-library/jest-dom/vitest" />

import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module '@vitest/expect' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion<T = unknown>
    extends TestingLibraryMatchers<ReturnType<typeof expect.stringContaining>, T> {}
}
