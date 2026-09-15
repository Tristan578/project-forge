/**
 * Minimal, SELF-CONTAINED type declarations for jest-axe used with Vitest.
 *
 * Mirrors apps/docs/jest-axe.d.ts on purpose. `web` imports `it`/`expect`/etc.
 * from `'vitest'` explicitly (not via globals), so this file must NOT augment
 * the `vitest` module: doing so would require a top-level `export`, which turns
 * the whole file into a module and makes `declare module 'vitest'` REPLACE
 * vitest's real types — erasing its exported members and breaking every
 * `import { ... } from 'vitest'` in the app. (packages/ui gets away with the
 * augmenting variant only because it uses vitest globals.)
 *
 * So `toHaveNoViolations` is deliberately not declared; the tests assert on
 * `results.violations` directly, which also prints the offending rules on
 * failure instead of a bare "expected no violations".
 */

declare module 'jest-axe' {
  /** One accessibility violation — only the fields the web tests read. */
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
}
