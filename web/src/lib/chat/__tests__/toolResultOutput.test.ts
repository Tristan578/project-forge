import { describe, it, expect } from 'vitest';
import { formatToolResultOutput, MAX_TOOL_RESULT_CHARS } from '../toolResultOutput';

describe('formatToolResultOutput (#10143)', () => {
  it('serialises an object result so the model can read it', () => {
    const text = formatToolResultOutput({ components: [{ type: 'health', health: { maxHp: 100 } }], count: 1 });
    expect(text).toBe('{"components":[{"type":"health","health":{"maxHp":100}}],"count":1}');
    expect(text).not.toContain('[object Object]');
  });

  it('serialises arrays and numbers the same way', () => {
    expect(formatToolResultOutput([1, 'two', { three: 3 }])).toBe('[1,"two",{"three":3}]');
    expect(formatToolResultOutput(42)).toBe('42');
    expect(formatToolResultOutput(false)).toBe('false');
  });

  it('passes a string result through verbatim', () => {
    expect(formatToolResultOutput('Deleted 1 entity')).toBe('Deleted 1 entity');
    // Not JSON-quoted: the model should read the sentence, not a literal.
    expect(formatToolResultOutput('Deleted 1 entity')).not.toBe('"Deleted 1 entity"');
    expect(formatToolResultOutput('')).toBe('');
  });

  it('reports "Success" for a handler that returned nothing', () => {
    expect(formatToolResultOutput(undefined)).toBe('Success');
    expect(formatToolResultOutput(null)).toBe('Success');
    // `JSON.stringify` yields undefined for these; the call still ran.
    expect(formatToolResultOutput(() => 1)).toBe('Success');
    expect(formatToolResultOutput(Symbol('s'))).toBe('Success');
  });

  it('bounds an oversized result and says how much was cut', () => {
    const nodes = Array.from({ length: 2_000 }, (_, i) => ({ id: `entity-${i}`, name: `Node ${i}` }));
    const full = JSON.stringify({ nodes });
    expect(full.length).toBeGreaterThan(MAX_TOOL_RESULT_CHARS);

    const text = formatToolResultOutput({ nodes });

    expect(text.startsWith(full.slice(0, MAX_TOOL_RESULT_CHARS))).toBe(true);
    expect(text).toContain(`[truncated: ${full.length - MAX_TOOL_RESULT_CHARS} of ${full.length} characters omitted]`);
    // The prefix plus the one-line marker, nothing more.
    expect(text.length).toBeLessThan(MAX_TOOL_RESULT_CHARS + 120);
  });

  it('leaves a result exactly at the bound alone', () => {
    const exact = 'x'.repeat(MAX_TOOL_RESULT_CHARS);
    expect(formatToolResultOutput(exact)).toBe(exact);
    expect(formatToolResultOutput('x'.repeat(MAX_TOOL_RESULT_CHARS + 1))).toContain('[truncated: 1 of');
  });

  it('honours a caller-supplied bound', () => {
    expect(formatToolResultOutput('abcdefghij', 4)).toBe('abcd\n… [truncated: 6 of 10 characters omitted]');
  });

  it('never yields "[object Object]" for a value JSON cannot serialise', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;
    const text = formatToolResultOutput(cyclic);
    expect(text).toMatch(/^\[result could not be serialised: /);
    expect(text).not.toContain('[object Object]');
    expect(formatToolResultOutput({ big: BigInt(10) })).toMatch(/^\[result could not be serialised: /);
  });
});
