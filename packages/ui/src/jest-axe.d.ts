/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Minimal type declarations for jest-axe used with Vitest.
 *
 * Replaces @types/jest-axe which pulls in @types/jest and its large
 * dependency tree (including a conflicting `expect` global).
 */

declare module 'jest-axe' {
  import type { AxeResults, RunOptions, Spec } from 'axe-core';

  interface AxeOptions extends RunOptions {
    globalOptions?: Spec;
  }

  export function axe(
    html: Element | string,
    options?: AxeOptions,
  ): Promise<AxeResults>;

  export function toHaveNoViolations(): {
    compare(results: AxeResults): { pass: boolean; message(): string };
  };
}

// Augment Vitest's Assertion interface so `expect(r).toHaveNoViolations()` is typed.
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion<_T = any> {
    toHaveNoViolations(): void;
  }
}
