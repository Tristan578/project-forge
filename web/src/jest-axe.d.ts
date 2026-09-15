/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Minimal type declarations for jest-axe used with Vitest.
 *
 * Replaces @types/jest-axe which pulls in @types/jest and its large
 * dependency tree (including a conflicting `expect` global).
 *
 * A COPY of packages/ui/src/jest-axe.d.ts, deliberately. Each deploy root has
 * its own tsconfig and cannot see above itself, so the shim in packages/ui does
 * not type the `web` root. `axe-core` resolves here because it is a declared
 * transitive of `@axe-core/playwright` (a web devDependency); `jest-axe` is a
 * workspace dependency (packages/ui) hoisted to the root install.
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
