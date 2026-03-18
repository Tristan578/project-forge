/**
 * Tests for the injectLoopGuards() source transformation (PF-511, PF-524, PF-589).
 *
 * PF-590: These tests import and exercise the PRODUCTION implementation from
 * loopGuards.ts — not a replicated copy. This ensures any regression in the
 * production algorithm is caught here rather than silently passing against a
 * stale local version.
 *
 * NOTE: Function constructor usage here is intentional — it replicates the exact
 * sandbox pattern from scriptWorker.ts to verify guard injection produces
 * valid executable code. This is test-only; the real security boundary is
 * Web Worker isolation + command whitelist.
 */

import { describe, it, expect } from 'vitest';
import { injectLoopGuards } from '@/lib/scripting/loopGuards';

// Use a small limit in tests to avoid slow iteration; production uses 1_000_000.
const TEST_LOOP_LIMIT = 10_000;

// ---------------------------------------------------------------------------
// Helper: execute guarded code. Mirrors compileScript() in scriptWorker.ts.
// ---------------------------------------------------------------------------

function runGuarded(source: string): void {
  const { source: guarded, guardVarNames } = injectLoopGuards(source);
  const resetBody = guardVarNames.length > 0
    ? guardVarNames.map(v => v + '=0;').join('')
    : '';
  const resetFn = resetBody
    ? 'function __resetGuards(){' + resetBody + '}'
    : 'function __resetGuards(){}';
  // sandbox execution intentional for loop-guard testing — codeql[js/code-injection]
  const sandboxCtor = Function;
  const fn = sandboxCtor(
    '__loopLimit',
    guarded + '\n' + resetFn,
  );
  fn(TEST_LOOP_LIMIT);
}

/** Build a wrapped onUpdate function that resets guards before each call (mirrors scriptWorker). */
function buildOnUpdate(source: string): (dt?: number) => void {
  const { source: guarded, guardVarNames } = injectLoopGuards(source);
  const resetBody = guardVarNames.length > 0
    ? guardVarNames.map(v => v + '=0;').join('')
    : '';
  const resetFn = 'function __resetGuards(){' + resetBody + '}';
  // sandbox execution intentional for loop-guard testing — codeql[js/code-injection]
  const sandboxCtor = Function;
  const factory = sandboxCtor(
    '__loopLimit',
    guarded + '\n' + resetFn + '\n' +
    'return typeof onUpdate===\"function\" ? function(dt){__resetGuards();onUpdate(dt);} : function(){};',
  );
  return factory(TEST_LOOP_LIMIT) as (dt?: number) => void;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('injectLoopGuards (production implementation)', () => {
  // -- Return shape --

  describe('return value', () => {
    it('returns { source, guardVarNames } object', () => {
      const result = injectLoopGuards('const x = 1;');
      expect(result).toHaveProperty('source');
      expect(result).toHaveProperty('guardVarNames');
      expect(Array.isArray(result.guardVarNames)).toBe(true);
    });

    it('returns empty guardVarNames when source has no loops', () => {
      const { guardVarNames } = injectLoopGuards('const x = 42;');
      expect(guardVarNames).toHaveLength(0);
    });

    it('returns one guardVarName per loop keyword', () => {
      const src = 'for (let i=0;i<3;i++){} while(false){} do{}while(false);';
      const { guardVarNames } = injectLoopGuards(src);
      expect(guardVarNames).toHaveLength(3);
    });

    it('guardVarNames are unique per loop', () => {
      const src = 'for(let i=0;i<2;i++){} for(let j=0;j<2;j++){}';
      const { guardVarNames } = injectLoopGuards(src);
      const unique = new Set(guardVarNames);
      expect(unique.size).toBe(guardVarNames.length);
    });
  });

  // -- PF-589: Counter reset between entry-point calls --

  describe('PF-589: counter reset between entry-point calls', () => {
    it('does not throw when onUpdate with 100-iteration loop runs 200 frames', () => {
      // With the fix: __resetGuards() resets counters before each onUpdate call.
      // Without the fix: after 100 frames the cumulative count would reach 10_000
      // and trigger the guard even though no single call exceeds the limit.
      const onUpdate = buildOnUpdate(
        'function onUpdate() { for(let i=0;i<100;i++){} }',
      );
      expect(() => {
        for (let frame = 0; frame < 200; frame++) onUpdate();
      }).not.toThrow();
    });

    it('still catches a genuine infinite loop within a single call', () => {
      const onUpdate = buildOnUpdate(
        'function onUpdate() { while(true){} }',
      );
      expect(() => onUpdate()).toThrow('Infinite loop detected');
    });

    it('just-under-limit loop runs indefinitely across frames', () => {
      const onUpdate = buildOnUpdate(
        `function onUpdate(){ for(let i=0;i<${TEST_LOOP_LIMIT - 1};i++){} }`,
      );
      expect(() => {
        for (let f = 0; f < 50; f++) onUpdate();
      }).not.toThrow();
    });

    it('onStart and onUpdate counters are independent', () => {
      const src = `
        function onStart() { for(let i=0;i<5000;i++){} }
        function onUpdate(_dt) { for(let j=0;j<5000;j++){} }
      `;
      const { source: guarded, guardVarNames } = injectLoopGuards(src);
      const resetBody = guardVarNames.map(v => v + '=0;').join('');
      const resetFn = 'function __resetGuards(){' + resetBody + '}';
      // sandbox execution intentional — codeql[js/code-injection]
      const sandboxCtor = Function;
      const factory = sandboxCtor(
        '__loopLimit',
        guarded + '\n' + resetFn + '\n' +
        'return {' +
        'onStart:typeof onStart===\"function\"?function(){__resetGuards();onStart();}:undefined,' +
        'onUpdate:typeof onUpdate===\"function\"?function(dt){__resetGuards();onUpdate(dt);}:undefined' +
        '};',
      );
      const inst = factory(TEST_LOOP_LIMIT) as {
        onStart: () => void;
        onUpdate: (_dt: number) => void;
      };
      expect(() => {
        inst.onStart();
        for (let f = 0; f < 10; f++) inst.onUpdate(0.016);
      }).not.toThrow();
    });
  });

  // -- Braced do...while --

  describe('braced do...while', () => {
    it('injects guard into do { ... } while (cond)', () => {
      const { source: output } = injectLoopGuards('do { x++ } while (x < 10)');
      expect(output).toContain('__lg');
      expect(output).toContain('Infinite loop detected');
    });

    it('produces valid JS for braced do...while', () => {
      expect(() => runGuarded('let x = 0; do { x++; } while (x < 5);')).not.toThrow();
    });

    it('terminates an infinite braced do...while', () => {
      const { source: guarded, guardVarNames } = injectLoopGuards('let x = 0; do { } while (true);');
      const resetBody = guardVarNames.map(v => v + '=0;').join('');
      // sandbox execution intentional — codeql[js/code-injection]
      const sandboxCtor = Function;
      const fn = sandboxCtor('__loopLimit', guarded + '\nfunction __resetGuards(){' + resetBody + '}');
      expect(() => fn(TEST_LOOP_LIMIT)).toThrow('Infinite loop detected');
    });
  });

  // -- Braceless do...while --

  describe('braceless do...while', () => {
    it('injects guard into do stmt; while (cond);', () => {
      const { source: output } = injectLoopGuards('let x = 0; do x++; while (x < 10);');
      expect(output).toContain('__lg');
      // Production emits `do {` (with space before brace), not `do{`
      expect(output).toContain('do ');
      expect(output).toContain('Infinite loop detected');
    });

    it('produces valid JS for braceless do...while', () => {
      expect(() => runGuarded('let x = 0; do x++; while (x < 5);')).not.toThrow();
    });

    it('terminates an infinite braceless do...while', () => {
      const { source: guarded, guardVarNames } = injectLoopGuards('let x = 0; do x = x; while (true);');
      const resetBody = guardVarNames.map(v => v + '=0;').join('');
      // sandbox execution intentional — codeql[js/code-injection]
      const sandboxCtor = Function;
      const fn = sandboxCtor('__loopLimit', guarded + '\nfunction __resetGuards(){' + resetBody + '}');
      expect(() => fn(TEST_LOOP_LIMIT)).toThrow('Infinite loop detected');
    });
  });

  // -- while loops --

  describe('while loops', () => {
    it('injects guard into while (cond) { ... }', () => {
      const { source: output } = injectLoopGuards('while (x < 10) { x++; }');
      expect(output).toContain('__lg');
    });

    it('produces valid JS for while loops', () => {
      expect(() => runGuarded('let x = 0; while (x < 5) { x++; }')).not.toThrow();
    });

    it('terminates an infinite while loop', () => {
      const { source: guarded, guardVarNames } = injectLoopGuards('while (true) { }');
      const resetBody = guardVarNames.map(v => v + '=0;').join('');
      // sandbox execution intentional — codeql[js/code-injection]
      const sandboxCtor = Function;
      const fn = sandboxCtor('__loopLimit', guarded + '\nfunction __resetGuards(){' + resetBody + '}');
      expect(() => fn(TEST_LOOP_LIMIT)).toThrow('Infinite loop detected');
    });

    it('does not inject into do...while tail', () => {
      const { source: output } = injectLoopGuards('let x = 0; do { x++; } while (x < 5);');
      const guardCount = (output.match(/__lg\d+/g) ?? []).length;
      expect(guardCount).toBe(2); // one guard only (declared + checked = 2 refs)
    });
  });

  // -- for loops --

  describe('for loops', () => {
    it('injects guard into for (...) { ... }', () => {
      const { source: output } = injectLoopGuards('for (let i = 0; i < 10; i++) { x++; }');
      expect(output).toContain('__lg');
    });

    it('produces valid JS for for loops', () => {
      expect(() => runGuarded('let sum = 0; for (let i = 0; i < 5; i++) { sum += i; }')).not.toThrow();
    });

    it('terminates an infinite for loop', () => {
      const { source: guarded, guardVarNames } = injectLoopGuards('for (;;) { }');
      const resetBody = guardVarNames.map(v => v + '=0;').join('');
      // sandbox execution intentional — codeql[js/code-injection]
      const sandboxCtor = Function;
      const fn = sandboxCtor('__loopLimit', guarded + '\nfunction __resetGuards(){' + resetBody + '}');
      expect(() => fn(TEST_LOOP_LIMIT)).toThrow('Infinite loop detected');
    });
  });

  // -- Nested loops --

  describe('nested loops', () => {
    it('gives each nested loop its own counter variable', () => {
      const { source: output } = injectLoopGuards('for (let i = 0; i < 3; i++) { while (false) { } }');
      expect(output).toContain('__lg0');
      expect(output).toContain('__lg1');
    });

    it('produces valid JS for nested loops', () => {
      expect(() => runGuarded('let s = 0; for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) { s++; } }')).not.toThrow();
    });

    it('handles nested do...while inside for', () => {
      expect(() => runGuarded('for (let i = 0; i < 3; i++) { let x = 0; do { x++; } while (x < 2); }')).not.toThrow();
    });

    it('nested loop counters reset independently between calls', () => {
      // 100 outer x 99 inner = 9,900 iterations — under the 10_000 limit.
      const onUpdate = buildOnUpdate(
        'function onUpdate(){ for(let i=0;i<100;i++){for(let j=0;j<99;j++){}} }',
      );
      expect(() => {
        for (let f = 0; f < 5; f++) onUpdate();
      }).not.toThrow();
    });
  });

  // -- Edge cases --

  describe('edge cases', () => {
    it('returns source unchanged when no loops present', () => {
      const source = 'const x = 42;';
      const { source: output } = injectLoopGuards(source);
      expect(output).toBe(source);
    });

    it('handles empty source', () => {
      const { source: output, guardVarNames } = injectLoopGuards('');
      expect(output).toBe('');
      expect(guardVarNames).toHaveLength(0);
    });

    it('preserves code outside loops', () => {
      const source = 'const a = 1; for (let i = 0; i < 1; i++) { } const b = 2;';
      const { source: output } = injectLoopGuards(source);
      expect(output).toContain('const a = 1;');
      expect(output).toContain('const b = 2;');
    });

    it('handles do...while with multiline body', () => {
      expect(() => runGuarded('let x = 0; do\n  x++;\nwhile (x < 5);')).not.toThrow();
    });

    it('does not inject into loop keywords inside single-quoted string literals', () => {
      const source = "const s = 'for while do'; const x = 1;";
      const { source: output, guardVarNames } = injectLoopGuards(source);
      expect(output).toBe(source);
      expect(guardVarNames).toHaveLength(0);
    });

    it('does not inject into loop keywords inside double-quoted string literals', () => {
      const source = 'const s = "for while do"; const x = 1;';
      const { source: output, guardVarNames } = injectLoopGuards(source);
      expect(output).toBe(source);
      expect(guardVarNames).toHaveLength(0);
    });

    it('does not inject into loop keywords inside line comments', () => {
      const source = '// for i in range(10)\nconst x = 1;';
      const { guardVarNames } = injectLoopGuards(source);
      expect(guardVarNames).toHaveLength(0);
    });

    it('does not inject into loop keywords inside block comments', () => {
      const source = '/* while true do */ const x = 1;';
      const { guardVarNames } = injectLoopGuards(source);
      expect(guardVarNames).toHaveLength(0);
    });
  });
});
