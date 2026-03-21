/**
 * PF-781: Regression tests for ReDoS safety in web/scripts/check-command-parity.js.
 *
 * The script uses two regexes to scan TypeScript handler files line-by-line.
 * This file verifies those patterns are linear-time and do not contain nested
 * quantifiers or overlapping alternations that cause catastrophic backtracking.
 *
 * Tested patterns (inlined from the script to avoid Node.js require paths):
 *   KEY_LINE_RE       -- detects a handler key line (e.g.  'create_entity':)
 *   HANDLERS_OPEN_RE  -- detects the opening of a handlers object
 */
import { describe, it, expect } from 'vitest';

// Exact regexes from web/scripts/check-command-parity.js
const KEY_LINE_RE = /^\s{2,}['"]?([a-z][a-z0-9_]*)['"]?\s*:/;
const HANDLERS_OPEN_RE = /(?:export\s+)?const\s+\w+[Hh]andlers\s*[=:]/;

function timeRegex(re: RegExp, input: string): number {
  const start = Date.now();
  re.test(input);
  return Date.now() - start;
}

describe('KEY_LINE_RE -- correctness', () => {
  it('matches a single-quoted handler key with two-space indent', () => {
    const match = KEY_LINE_RE.exec("  'create_entity': async (args) => {");
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe('create_entity');
  });

  it('matches an unquoted handler key with deeper indent', () => {
    const match = KEY_LINE_RE.exec('    move_entity: async (args) => {');
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe('move_entity');
  });

  it('matches a double-quoted handler key', () => {
    expect(KEY_LINE_RE.test('  "set_material": handler,')).toBe(true);
  });

  it('does not match a single-space indent', () => {
    expect(KEY_LINE_RE.test(" 'create_entity': handler")).toBe(false);
  });

  it('does not match comment lines', () => {
    expect(KEY_LINE_RE.test('  // create_entity:')).toBe(false);
    expect(KEY_LINE_RE.test('  /* block comment */')).toBe(false);
  });

  it('does not match uppercase-first identifiers', () => {
    expect(KEY_LINE_RE.test("  'MyHandler': fn")).toBe(false);
  });

  it('does not match lines without a trailing colon', () => {
    expect(KEY_LINE_RE.test('  create_entity')).toBe(false);
  });
});

describe('KEY_LINE_RE -- ReDoS safety (PF-781)', () => {
  it('completes in linear time on long no-match: many spaces + no colon', () => {
    const adversarial = ' '.repeat(5000) + 'abcdefghijk'.repeat(100);
    expect(timeRegex(KEY_LINE_RE, adversarial)).toBeLessThan(20);
  });

  it('completes in linear time on adversarial near-match: repeated quotes', () => {
    const adversarial = '  ' + "'".repeat(1000) + 'a'.repeat(1000);
    expect(timeRegex(KEY_LINE_RE, adversarial)).toBeLessThan(20);
  });
});

describe('HANDLERS_OPEN_RE -- correctness', () => {
  it('matches an exported handlers declaration', () => {
    expect(HANDLERS_OPEN_RE.test('export const transformHandlers = {')).toBe(true);
  });

  it('matches a non-exported handlers declaration', () => {
    expect(HANDLERS_OPEN_RE.test('const materialHandlers: Record<string, ToolHandler> = {')).toBe(true);
  });

  it('matches handlers with lower-h suffix', () => {
    expect(HANDLERS_OPEN_RE.test('const queryHandlers = {')).toBe(true);
  });

  it('does not match identifiers without Handlers/handlers suffix', () => {
    expect(HANDLERS_OPEN_RE.test('const transformMap = {')).toBe(false);
    expect(HANDLERS_OPEN_RE.test('const myFunctions = {')).toBe(false);
  });
});

describe('HANDLERS_OPEN_RE -- ReDoS safety (PF-781)', () => {
  it('completes in linear time on adversarial repeated export tokens', () => {
    const adversarial = ('export ' + ' '.repeat(20)).repeat(200) + 'const notAMatch =';
    expect(timeRegex(HANDLERS_OPEN_RE, adversarial)).toBeLessThan(20);
  });

  it('completes in linear time on a very long non-matching identifier', () => {
    const adversarial = 'const ' + 'x'.repeat(5000) + 'handlers = {';
    expect(timeRegex(HANDLERS_OPEN_RE, adversarial)).toBeLessThan(20);
  });

  it('completes in linear time on deeply nested whitespace', () => {
    const adversarial = 'export' + ' '.repeat(2000) + 'const notHandlers =';
    expect(timeRegex(HANDLERS_OPEN_RE, adversarial)).toBeLessThan(20);
  });
});
