/**
 * Tests for the SpawnForge agent module:
 *
 * 1. buildAgentInstructions — pure function, exercises the cache_control / tier
 *    routing logic for direct vs gateway backends.
 * 2. createSpawnforgeAgent — providerOptions construction (thinking + effort).
 *    Mocks ToolLoopAgent so we can assert constructor args without spinning up
 *    a real agent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockToolLoopAgent = vi.fn();

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    ToolLoopAgent: class {
      constructor(args: unknown) {
        mockToolLoopAgent(args);
      }
    },
    stepCountIs: vi.fn((n: number) => ({ _stop: 'stepCount', n })),
  };
});

vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn((id: string) => ({ _provider: 'anthropic', id })),
}));

vi.mock('@ai-sdk/gateway', () => ({
  gateway: vi.fn((id: string) => ({ _provider: 'gateway', id })),
}));

vi.mock('@/lib/ai/toolAdapter', () => ({
  convertManifestToolsToSdkTools: vi.fn(() => ({})),
}));

vi.mock('@/lib/ai/models', () => ({
  AI_MODEL_PRIMARY: 'claude-sonnet-4.5',
  AI_MODELS: { gatewayChat: 'anthropic/claude-sonnet-4.6' },
}));

vi.mock('@/data/commands.json', () => ({
  default: { version: '1', commands: [] },
}));

import {
  buildAgentInstructions,
  createSpawnforgeAgent,
} from '@/lib/ai/spawnforgeAgent';

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

const baseOptions = {
  isDirectBackend: true,
  model: 'claude-sonnet-4.5',
  instructions: 'system text',
};

describe('createSpawnforgeAgent — providerOptions', () => {
  beforeEach(() => {
    mockToolLoopAgent.mockClear();
  });

  it('omits providerOptions when neither thinking nor effort is set', () => {
    createSpawnforgeAgent(baseOptions);
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: unknown };
    expect(args.providerOptions).toBeUndefined();
  });

  it('emits anthropic.thinking when thinking=true on direct backend', () => {
    createSpawnforgeAgent({ ...baseOptions, thinking: true });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: { anthropic: unknown } };
    expect(args.providerOptions).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 10000 } },
    });
  });

  it('emits anthropic.effort when effort is set on direct backend', () => {
    createSpawnforgeAgent({ ...baseOptions, effort: 'medium' });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: { anthropic: unknown } };
    expect(args.providerOptions).toEqual({
      anthropic: { effort: 'medium' },
    });
  });

  it('emits both thinking and effort together when both are set', () => {
    createSpawnforgeAgent({ ...baseOptions, thinking: true, effort: 'high' });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: { anthropic: unknown } };
    expect(args.providerOptions).toEqual({
      anthropic: {
        thinking: { type: 'enabled', budgetTokens: 10000 },
        effort: 'high',
      },
    });
  });

  it('does not emit providerOptions for gateway backend even with thinking/effort', () => {
    createSpawnforgeAgent({
      ...baseOptions,
      isDirectBackend: false,
      thinking: true,
      effort: 'medium',
    });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: unknown };
    expect(args.providerOptions).toBeUndefined();
  });

  it('forwards effort=low and effort=high without modification', () => {
    createSpawnforgeAgent({ ...baseOptions, effort: 'low' });
    expect(
      (mockToolLoopAgent.mock.calls[0][0] as { providerOptions: { anthropic: { effort: string } } })
        .providerOptions.anthropic.effort,
    ).toBe('low');

    mockToolLoopAgent.mockClear();
    createSpawnforgeAgent({ ...baseOptions, effort: 'high' });
    expect(
      (mockToolLoopAgent.mock.calls[0][0] as { providerOptions: { anthropic: { effort: string } } })
        .providerOptions.anthropic.effort,
    ).toBe('high');
  });
});
