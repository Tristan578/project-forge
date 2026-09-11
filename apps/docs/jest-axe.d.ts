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
 *
 * SELF-CONTAINED ON PURPOSE — and this is the part that actually broke that
 * deploy.
 *
 * This file used to open with `import type { AxeResults, RunOptions, Spec }
 * from 'axe-core'`. Neither `jest-axe` nor `axe-core` is declared in
 * apps/docs/package.json: they resolve from the workspace root during local
 * development, which is exactly the "cannot see above itself" trap the
 * paragraph above warns about. Vercel builds this app with
 * `rootDirectory: apps/docs`, where those packages do not exist, so the import
 * resolved to nothing, `AxeResults` became an error type, `results` collapsed
 * to `any`, and `results.violations.map((v) => v.id)` failed `next build` with
 * TS7006 — breaking the production docs deploy on four consecutive commits.
 *
 * A local `tsc --noEmit` cannot catch this, because locally those packages ARE
 * resolvable. The only environment that sees the truth is the deploy root, so
 * the declarations below borrow no types from outside this directory and
 * describe only what this app actually calls.
 */

declare module 'jest-axe' {
  /** One accessibility violation — only the fields this app reads. */
  interface AxeViolation {
    id: string;
    impact?: string | null;
    description?: string;
    help?: string;
    helpUrl?: string;
    nodes?: unknown[];
  }

  interface AxeResults {
    violations: AxeViolation[];
    passes?: unknown[];
    incomplete?: unknown[];
    inapplicable?: unknown[];
  }

  interface AxeOptions {
    rules?: Record<string, { enabled: boolean }>;
    runOnly?: unknown;
    globalOptions?: unknown;
    [key: string]: unknown;
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
