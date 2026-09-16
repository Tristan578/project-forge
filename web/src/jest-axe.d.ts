/**
 * Minimal, SELF-CONTAINED type declarations for jest-axe used with Vitest.
 *
 * This script supplies an ambient declaration for the otherwise untyped
 * jest-axe package. An ambient declaration in a script can shadow an existing
 * module's types; a declaration in a file with a top-level import/export is
 * instead a module augmentation and preserves existing exports. No Vitest
 * declaration is needed here because tests inspect violations directly.
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

  /** Accessibility results; web tests assert directly on violations. */
  interface AxeResults {
    violations: AxeViolation[];
    passes?: unknown[];
    incomplete?: unknown[];
    inapplicable?: unknown[];
  }

  /** Optional jest-axe rule and execution configuration. */
  interface AxeOptions {
    rules?: Record<string, { enabled: boolean }>;
    runOnly?: unknown;
    globalOptions?: unknown;
    [key: string]: unknown;
  }

  /**
   * Audit a DOM element or HTML string with optional axe configuration.
   * @param html Rendered element or HTML markup to inspect.
   * @param options Optional rule/execution configuration.
   * @returns A promise of accessibility findings, including violations.
   */
  export function axe(
    html: Element | string,
    options?: AxeOptions,
  ): Promise<AxeResults>;
}
