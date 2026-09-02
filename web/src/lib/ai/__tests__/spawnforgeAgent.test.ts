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

vi.mock('@/lib/ai/models', async () => {
  // Real thinkingModeFor / supportsEffort (#9626); only the ids are stubbed.
  const actual = await vi.importActual<typeof import('@/lib/ai/models')>('@/lib/ai/models');
  return {
    ...actual,
    AI_MODEL_PRIMARY: 'claude-sonnet-4.5',
    AI_MODELS: { gatewayChat: 'anthropic/claude-sonnet-4.6' },
  };
});

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

  // The shape is decided by the MODEL (#9626): baseOptions' claude-sonnet-4.5
  // takes the budget form; the premium model takes adaptive and effort.
  const premiumOptions = { ...baseOptions, model: 'claude-opus-4-8' };

  it('emits the budget thinking form for a model that rejects adaptive (sonnet 4.5)', () => {
    createSpawnforgeAgent({ ...baseOptions, thinking: true });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: { anthropic: unknown } };
    expect(args.providerOptions).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 10000 } },
    });
  });

  it('emits the adaptive thinking form for the premium model, which 400s on the budget form', () => {
    createSpawnforgeAgent({ ...premiumOptions, thinking: true });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: { anthropic: unknown } };
    expect(args.providerOptions).toEqual({
      anthropic: { thinking: { type: 'adaptive' } },
    });
  });

  it('emits anthropic.effort when effort is set on a model that supports it', () => {
    createSpawnforgeAgent({ ...premiumOptions, effort: 'medium' });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: { anthropic: unknown } };
    expect(args.providerOptions).toEqual({
      anthropic: { effort: 'medium' },
    });
  });

  it('drops effort for a model that 400s on it (Haiku 4.5), keeping the budget thinking form', () => {
    createSpawnforgeAgent({ ...baseOptions, model: 'claude-haiku-4-5-20251001', thinking: true, effort: 'high' });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: { anthropic: unknown } };
    expect(args.providerOptions).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 10000 } },
    });
  });

  it('omits providerOptions entirely when only an unsupported effort is set', () => {
    createSpawnforgeAgent({ ...baseOptions, effort: 'medium' });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: unknown };
    expect(args.providerOptions).toBeUndefined();
  });

  it('emits both adaptive thinking and effort together on the premium model', () => {
    createSpawnforgeAgent({ ...premiumOptions, thinking: true, effort: 'high' });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: { anthropic: unknown } };
    expect(args.providerOptions).toEqual({
      anthropic: {
        thinking: { type: 'adaptive' },
        effort: 'high',
      },
    });
  });

  it.each([
    ['claude-opus-4-8', { type: 'adaptive' }],
    ['claude-sonnet-4-6', { type: 'adaptive' }],
    ['claude-sonnet-4.5', { type: 'enabled', budgetTokens: 10000 }],
    ['claude-haiku-4-5-20251001', { type: 'enabled', budgetTokens: 10000 }],
  ])('thinking shape for %s', (model, expected) => {
    createSpawnforgeAgent({ ...baseOptions, model, thinking: true });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: { anthropic: { thinking: unknown } } };
    expect(args.providerOptions?.anthropic.thinking).toEqual(expected);
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
    createSpawnforgeAgent({ ...premiumOptions, effort: 'low' });
    expect(
      (mockToolLoopAgent.mock.calls[0][0] as { providerOptions: { anthropic: { effort: string } } })
        .providerOptions.anthropic.effort,
    ).toBe('low');

    mockToolLoopAgent.mockClear();
    createSpawnforgeAgent({ ...premiumOptions, effort: 'high' });
    expect(
      (mockToolLoopAgent.mock.calls[0][0] as { providerOptions: { anthropic: { effort: string } } })
        .providerOptions.anthropic.effort,
    ).toBe('high');
  });
});

describe('createSpawnforgeAgent — providerOptions.gateway (PF-969 / #8954)', () => {
  const gatewayBase = { ...baseOptions, isDirectBackend: false };

  beforeEach(() => {
    mockToolLoopAgent.mockClear();
  });

  it('omits providerOptions on the gateway backend when neither userId nor tags is set', () => {
    createSpawnforgeAgent(gatewayBase);
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: unknown };
    expect(args.providerOptions).toBeUndefined();
  });

  it('emits providerOptions.gateway.user on the gateway backend when userId is set', () => {
    createSpawnforgeAgent({ ...gatewayBase, userId: 'user_123' });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: { gateway: unknown } };
    expect(args.providerOptions).toEqual({ gateway: { user: 'user_123' } });
  });

  it('emits providerOptions.gateway.tags on the gateway backend when tags is set', () => {
    createSpawnforgeAgent({ ...gatewayBase, tags: ['route:chat', 'tier:pro'] });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: { gateway: unknown } };
    expect(args.providerOptions).toEqual({ gateway: { tags: ['route:chat', 'tier:pro'] } });
  });

  it('emits both userId and tags together on the gateway backend', () => {
    createSpawnforgeAgent({ ...gatewayBase, userId: 'user_123', tags: ['route:chat'] });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: { gateway: unknown } };
    expect(args.providerOptions).toEqual({
      gateway: { user: 'user_123', tags: ['route:chat'] },
    });
  });

  it('ignores an empty tags array (does not emit an empty gateway.tags field)', () => {
    createSpawnforgeAgent({ ...gatewayBase, tags: [] });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: unknown };
    expect(args.providerOptions).toBeUndefined();
  });

  it('never emits providerOptions.gateway on the direct backend, even with userId/tags set', () => {
    createSpawnforgeAgent({
      ...baseOptions,
      isDirectBackend: true,
      userId: 'user_123',
      tags: ['route:chat'],
    });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: { anthropic?: unknown; gateway?: unknown } };
    expect(args.providerOptions?.gateway).toBeUndefined();
  });

  it('combines anthropic thinking/effort (direct) is mutually exclusive with gateway tagging — direct backend still omits gateway even when both fields are populated', () => {
    createSpawnforgeAgent({
      ...baseOptions,
      isDirectBackend: true,
      thinking: true,
      userId: 'user_123',
    });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: { anthropic?: unknown; gateway?: unknown } };
    expect(args.providerOptions).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 10000 } },
    });
  });
});
