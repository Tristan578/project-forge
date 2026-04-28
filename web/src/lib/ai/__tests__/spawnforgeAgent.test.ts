import { describe, it, expect } from 'vitest';
import { buildAgentInstructions } from '../spawnforgeAgent';

describe('buildAgentInstructions', () => {
  it('passes a plain string through unchanged', () => {
    expect(buildAgentInstructions('hello', true)).toBe('hello');
    expect(buildAgentInstructions('hello', false)).toBe('hello');
  });

  it('returns an empty string when given an empty block list', () => {
    expect(buildAgentInstructions([], true)).toBe('');
    expect(buildAgentInstructions([], false)).toBe('');
  });

  it('drops blocks with empty text', () => {
    const out = buildAgentInstructions(
      [
        { text: '', tier: 'long' },
        { text: 'real content', tier: 'long' },
        { text: '' },
      ],
      true,
    );
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
  });

  it('emits one SystemModelMessage per block on the direct backend with tier-aware cache_control', () => {
    const out = buildAgentInstructions(
      [
        { text: 'base prompt', tier: 'long' },
        { text: 'scene context', tier: 'long' },
        { text: 'doc context' }, // short / no tag
      ],
      true,
    );
    expect(out).toEqual([
      {
        role: 'system',
        content: 'base prompt',
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } },
        },
      },
      {
        role: 'system',
        content: 'scene context',
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } },
        },
      },
      { role: 'system', content: 'doc context' },
    ]);
  });

  it('emits short-tier cache_control without a ttl on the direct backend', () => {
    const out = buildAgentInstructions(
      [{ text: 'per-turn snippet', tier: 'short' }],
      true,
    );
    expect(out).toEqual([
      {
        role: 'system',
        content: 'per-turn snippet',
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
      },
    ]);
  });

  it('collapses blocks back into a single string on non-direct (gateway) backends', () => {
    const out = buildAgentInstructions(
      [
        { text: 'base prompt', tier: 'long' },
        { text: 'scene context', tier: 'long' },
        { text: 'doc context' },
      ],
      false,
    );
    expect(out).toBe('base prompt\n\nscene context\n\ndoc context');
  });

  it('omits providerOptions on direct backend blocks that have no tier', () => {
    const out = buildAgentInstructions([{ text: 'untagged' }], true) as Array<
      Record<string, unknown>
    >;
    expect(out[0]).not.toHaveProperty('providerOptions');
  });
});
