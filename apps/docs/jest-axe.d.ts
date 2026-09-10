/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Minimal type declarations for jest-axe used with Vitest.
 *
 * Replaces @types/jest-axe, which pulls in @types/jest and its large dependency
 * tree, including a conflicting `expect` global.
 *
 * A COPY of packages/ui/src/jest-axe.d.ts, deliberately. Each deploy root has
 * its own tsconfig and cannot see above itself — the same constraint that makes
 * apps/docs carry its own copy of the commands manifest — so a shim in
 * packages/ui does not type this app. Without it `tsc --noEmit` here fails on
 * TS7016, and nothing in CI ran that: both typecheck jobs are scoped to web/,
 * and the docs gate ran vitest only. Next.js type-checks during `next build`,
 * so the first thing to notice would have been the production docs deploy.
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

  // `toHaveNoViolations` is deliberately NOT declared, and the matcher is not
  // used. Registering it would need `declare module 'vitest'` to AUGMENT the
  // Assertion interface, and augmentation requires this file to be a module —
  // which would in turn make the `jest-axe` block above an augmentation of a
  // module that has no types to augment, breaking every vitest import in the
  // app. Asserting on `results.violations` needs neither, and prints the
  // offending rules on failure instead of a bare "expected no violations".
}
