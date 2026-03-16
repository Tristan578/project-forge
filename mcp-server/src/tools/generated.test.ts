import { describe, it, expect } from 'vitest';

describe('MCP tool error format', () => {
  function formatToolError(error: unknown): { isError: true; content: { type: string; text: string }[] } {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof Error && 'code' in error
      ? String((error as Error & { code?: string }).code)
      : 'INTERNAL_ERROR';
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ code, message }) }],
      isError: true,
    };
  }

  it('formats Error with INTERNAL_ERROR default', () => {
    const parsed = JSON.parse(formatToolError(new Error('broke')).content[0].text);
    expect(parsed).toEqual({ code: 'INTERNAL_ERROR', message: 'broke' });
  });
  it('uses error.code when available', () => {
    const err = Object.assign(new Error('nope'), { code: 'NOT_FOUND' });
    expect(JSON.parse(formatToolError(err).content[0].text).code).toBe('NOT_FOUND');
  });
  it('formats string errors', () => {
    const parsed = JSON.parse(formatToolError('raw').content[0].text);
    expect(parsed).toEqual({ code: 'INTERNAL_ERROR', message: 'raw' });
  });
  it('formats null/undefined', () => {
    expect(JSON.parse(formatToolError(null).content[0].text).message).toBe('null');
    expect(JSON.parse(formatToolError(undefined).content[0].text).message).toBe('undefined');
  });
  it('always valid JSON', () => {
    for (const e of [new Error('"quotes"'), 'special']) {
      expect(() => JSON.parse(formatToolError(e).content[0].text)).not.toThrow();
    }
  });
  it('isError true with one text entry', () => {
    const r = formatToolError(new Error('test'));
    expect(r.isError).toBe(true);
    expect(r.content).toHaveLength(1);
    expect(r.content[0].type).toBe('text');
  });
});
