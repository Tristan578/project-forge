/**
 * Tests for the injectLoopGuards() source transformation (PF-511).
 *
 * Since scriptWorker.ts runs inside a Web Worker, we replicate the
 * injectLoopGuards() function here for direct testing — same pattern
 * used by scriptSandbox.test.ts for the sandbox compilation.
 *
 * NOTE: new Function() usage here is intentional — it replicates the
 * exact sandbox pattern from scriptWorker.ts to verify guard injection
 * produces valid executable code. This is test-only; the real security
 * boundary is Web Worker isolation + command whitelist.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Replicated from scriptWorker.ts — keep in sync
// ---------------------------------------------------------------------------

const MAX_LOOP_ITERATIONS = 1_000_000;

function injectLoopGuards(source: string): string {
  let counter = 0;
  function makeGuard(): string {
    const id = counter++;
    return `var __lc${id}=0;if(++__lc${id}>${MAX_LOOP_ITERATIONS}){throw new Error("Infinite loop detected")}`;
  }
  let result = source.replace(
    /\bdo\s+(?!\{)([\s\S]*?);\s*while\s*\(([^)]*)\)\s*;?/g,
    (_m, stmt: string, cond: string) => `do{${makeGuard()}${stmt.trim()};}while(${cond});`
  );
  result = result.replace(/\bdo\s*\{/g, () => `do{${makeGuard()}`);
  result = result.replace(
    /\bwhile\s*\(([^)]*)\)\s*\{/g,
    (match, _c, offset) => {
      const before = result.slice(Math.max(0, offset - 20), offset).trimEnd();
      if (before.endsWith('}') || before.endsWith(');')) return match;
      return `${match}${makeGuard()}`;
    }
  );
  result = result.replace(/\bfor\s*\([^)]*\)\s*\{/g, (match) => `${match}${makeGuard()}`);
  return result;
}

// ---------------------------------------------------------------------------
// Helper: compile and run guarded code to verify it produces valid JS.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-implied-eval */
function compileAndRun(source: string): void {
  const guarded = injectLoopGuards(source);
  const fn = new Function(guarded); // codeql[js/code-injection] test-only sandbox verification
  fn();
}
/* eslint-enable @typescript-eslint/no-implied-eval */

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('injectLoopGuards', () => {
  describe('braced do...while', () => {
    it('injects guard into do { ... } while (cond)', () => {
      const input = 'do { x++ } while (x < 10)';
      const output = injectLoopGuards(input);
      expect(output).toContain('__lc');
      expect(output).toContain('Infinite loop detected');
    });

    it('produces valid JS for braced do...while', () => {
      const source = 'let x = 0; do { x++; } while (x < 5);';
      expect(() => compileAndRun(source)).not.toThrow();
    });

    it('terminates an infinite braced do...while', () => {
      const source = 'let x = 0; do { /* no increment */ } while (true);';
      const guarded = injectLoopGuards(source);
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function(guarded); // codeql[js/code-injection] test-only
      expect(() => fn()).toThrow('Infinite loop detected');
    });
  });

  describe('braceless do...while', () => {
    it('injects guard into do stmt; while (cond);', () => {
      const input = 'let x = 0; do x++; while (x < 10);';
      const output = injectLoopGuards(input);
      expect(output).toContain('__lc');
      expect(output).toContain('do{');
    });

    it('produces valid JS for braceless do...while', () => {
      const source = 'let x = 0; do x++; while (x < 5);';
      expect(() => compileAndRun(source)).not.toThrow();
    });

    it('terminates an infinite braceless do...while', () => {
      const source = 'let x = 0; do x = x; while (true);';
      const guarded = injectLoopGuards(source);
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function(guarded); // codeql[js/code-injection] test-only
      expect(() => fn()).toThrow('Infinite loop detected');
    });
  });

  describe('while loops', () => {
    it('injects guard into while (cond) { ... }', () => {
      const input = 'while (x < 10) { x++; }';
      const output = injectLoopGuards(input);
      expect(output).toContain('__lc');
    });

    it('produces valid JS for while loops', () => {
      const source = 'let x = 0; while (x < 5) { x++; }';
      expect(() => compileAndRun(source)).not.toThrow();
    });

    it('terminates an infinite while loop', () => {
      const source = 'while (true) { }';
      const guarded = injectLoopGuards(source);
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function(guarded); // codeql[js/code-injection] test-only
      expect(() => fn()).toThrow('Infinite loop detected');
    });

    it('does not inject into do...while tail', () => {
      const source = 'let x = 0; do { x++; } while (x < 5);';
      const output = injectLoopGuards(source);
      // Each guard uses the variable twice (declaration + check), so 2 references per guard
      const guardCount = (output.match(/__lc\d+/g) || []).length;
      expect(guardCount).toBe(2); // one guard only
    });
  });

  describe('for loops', () => {
    it('injects guard into for (...) { ... }', () => {
      const input = 'for (let i = 0; i < 10; i++) { x++; }';
      const output = injectLoopGuards(input);
      expect(output).toContain('__lc');
    });

    it('produces valid JS for for loops', () => {
      const source = 'let sum = 0; for (let i = 0; i < 5; i++) { sum += i; }';
      expect(() => compileAndRun(source)).not.toThrow();
    });

    it('terminates an infinite for loop', () => {
      const source = 'for (;;) { }';
      const guarded = injectLoopGuards(source);
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function(guarded); // codeql[js/code-injection] test-only
      expect(() => fn()).toThrow('Infinite loop detected');
    });
  });

  describe('nested loops', () => {
    it('gives each nested loop its own counter', () => {
      const source = 'for (let i = 0; i < 3; i++) { while (false) { } }';
      const output = injectLoopGuards(source);
      expect(output).toContain('__lc0');
      expect(output).toContain('__lc1');
    });

    it('produces valid JS for nested loops', () => {
      const source = 'let s = 0; for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) { s++; } }';
      expect(() => compileAndRun(source)).not.toThrow();
    });

    it('handles nested do...while inside for', () => {
      const source = 'for (let i = 0; i < 3; i++) { let x = 0; do { x++; } while (x < 2); }';
      expect(() => compileAndRun(source)).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('returns source unchanged when no loops present', () => {
      const source = 'const x = 42;';
      expect(injectLoopGuards(source)).toBe(source);
    });

    it('handles empty source', () => {
      expect(injectLoopGuards('')).toBe('');
    });

    it('preserves code outside loops', () => {
      const source = 'const a = 1; for (let i = 0; i < 1; i++) { } const b = 2;';
      const output = injectLoopGuards(source);
      expect(output).toContain('const a = 1;');
      expect(output).toContain('const b = 2;');
    });

    it('handles do...while with multiline statement', () => {
      const source = 'let x = 0; do\n  x++;\nwhile (x < 5);';
      const guarded = injectLoopGuards(source);
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function(guarded); // codeql[js/code-injection] test-only
      expect(() => fn()).not.toThrow();
    });

    it('MAX_LOOP_ITERATIONS constant is 1_000_000', () => {
      expect(MAX_LOOP_ITERATIONS).toBe(1_000_000);
    });
  });
});
