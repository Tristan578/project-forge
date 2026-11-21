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

// `@/lib/ai/models` is deliberately NOT mocked. Replacing it with a fixture
// set of invented ids decoupled the providerOptions this suite asserts from
// the per-model table production actually consults (PF-1216 / #9339).

vi.mock('@/data/commands.json', () => ({
  default: { version: '1', commands: [] },
}));

import {
  buildAgentInstructions,
  createSpawnforgeAgent,
} from '@/lib/ai/spawnforgeAgent';
import {
  AI_MODEL_PREMIUM,
  AI_MODEL_PRIMARY,
  GATEWAY_MODEL_CHAT,
  GATEWAY_MODEL_FAST,
  GATEWAY_MODEL_PREMIUM,
} from '@/lib/ai/models';

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

// The model id is load-bearing now: the thinking/effort shape is chosen per
// model by `models.ts`, not per backend (PF-1216 / #9339). Use the live
// primary constant so this base case tracks whatever the product ships.
const baseOptions = {
  isDirectBackend: true,
  model: AI_MODEL_PRIMARY,
  instructions: 'system text',
};

describe('createSpawnforgeAgent — providerOptions', () => {
  beforeEach(() => {
    mockToolLoopAgent.mockClear();
  });

  // Both are Claude 5 (adaptive + effort); the per-model table below is what
  // covers the families that answer a different shape.
  const premiumOptions = { ...baseOptions, model: AI_MODEL_PREMIUM };

  it('omits providerOptions when neither thinking nor effort is set', () => {
    createSpawnforgeAgent(baseOptions);
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: unknown };
    expect(args.providerOptions).toBeUndefined();
  });

  it('emits the adaptive thinking shape for a Claude 5 model on the direct backend', () => {
    createSpawnforgeAgent({ ...baseOptions, thinking: true });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: { anthropic: unknown } };
    expect(args.providerOptions).toEqual({
      anthropic: { thinking: { type: 'adaptive' } },
    });
  });

  // The regression this whole table exists for: Claude 4.7+ answers
  // `{ type: 'enabled' }` with HTTP 400, and Haiku 4.5 answers
  // `{ type: 'adaptive' }` with HTTP 400. Asserting the ABSENCE of the wrong
  // key is the half that would have caught the live bug.
  it.each([
    ['claude-sonnet-5', { type: 'adaptive' }],
    ['claude-opus-5', { type: 'adaptive' }],
    ['claude-sonnet-4-6', { type: 'adaptive' }],
    ['claude-opus-4-8', { type: 'adaptive' }],
    ['claude-haiku-4-5', { type: 'enabled', budgetTokens: 10000 }],
    ['claude-haiku-4-5-20251001', { type: 'enabled', budgetTokens: 10000 }],
    // The dotted spelling parses the same as the dashed one (#9626).
    ['claude-sonnet-4.5', { type: 'enabled', budgetTokens: 10000 }],
  ])('emits the right thinking shape for %s', (model, expected) => {
    createSpawnforgeAgent({ ...baseOptions, model, thinking: true });
    const args = mockToolLoopAgent.mock.calls[0][0] as {
      providerOptions?: { anthropic: { thinking?: Record<string, unknown> } };
    };
    expect(args.providerOptions?.anthropic.thinking).toEqual(expected);
  });

  it('never sends budgetTokens to a Claude 5 model', () => {
    for (const model of ['claude-sonnet-5', 'claude-opus-5']) {
      mockToolLoopAgent.mockClear();
      createSpawnforgeAgent({ ...baseOptions, model, thinking: true, effort: 'high' });
      const args = mockToolLoopAgent.mock.calls[0][0] as {
        providerOptions?: { anthropic: { thinking?: Record<string, unknown> } };
      };
      expect(args.providerOptions?.anthropic.thinking).not.toHaveProperty('budgetTokens');
      expect(args.providerOptions?.anthropic.thinking).not.toHaveProperty('type', 'enabled');
    }
  });

  it('omits thinking entirely for a model with no known shape rather than 400-ing', () => {
    // Fail-safe direction: an unmapped id degrades the feature to a no-op.
    createSpawnforgeAgent({ ...baseOptions, model: 'gpt-4o-mini', thinking: true });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: unknown };
    expect(args.providerOptions).toBeUndefined();
  });

  it('drops effort for a model that does not accept it (Haiku 4.5)', () => {
    createSpawnforgeAgent({ ...baseOptions, model: 'claude-haiku-4-5', effort: 'high' });
    const args = mockToolLoopAgent.mock.calls[0][0] as {
      providerOptions?: { anthropic?: { effort?: string } };
    };
    expect(args.providerOptions).toBeUndefined();
  });

  it('emits anthropic.effort when effort is set on direct backend', () => {
    createSpawnforgeAgent({ ...baseOptions, effort: 'medium' });
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

  it('does not emit anthropic thinking/effort for the gateway backend (only the gateway routing fields)', () => {
    createSpawnforgeAgent({
      ...baseOptions,
      isDirectBackend: false,
      thinking: true,
      effort: 'medium',
    });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: { anthropic?: unknown; gateway?: unknown } };
    expect(args.providerOptions?.anthropic).toBeUndefined();
    expect(args.providerOptions).toEqual({
      gateway: { models: [GATEWAY_MODEL_FAST], caching: 'auto' },
    });
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

  // These cases run on the real primary model, which sits mid-chain, so each
  // one carries the ordered fallback list alongside the field under test.
  it('always emits gateway.caching on the gateway backend, even with neither userId nor tags', () => {
    createSpawnforgeAgent(gatewayBase);
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: unknown };
    expect(args.providerOptions).toEqual({ gateway: { models: [GATEWAY_MODEL_FAST], caching: 'auto' } });
  });

  it('emits providerOptions.gateway.user on the gateway backend when userId is set', () => {
    createSpawnforgeAgent({ ...gatewayBase, userId: 'user_123' });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: { gateway: unknown } };
    expect(args.providerOptions).toEqual({
      gateway: { user: 'user_123', models: [GATEWAY_MODEL_FAST], caching: 'auto' },
    });
  });

  it('emits providerOptions.gateway.tags on the gateway backend when tags is set', () => {
    createSpawnforgeAgent({ ...gatewayBase, tags: ['route:chat', 'tier:pro'] });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: { gateway: unknown } };
    expect(args.providerOptions).toEqual({
      gateway: { tags: ['route:chat', 'tier:pro'], models: [GATEWAY_MODEL_FAST], caching: 'auto' },
    });
  });

  it('emits both userId and tags together on the gateway backend', () => {
    createSpawnforgeAgent({ ...gatewayBase, userId: 'user_123', tags: ['route:chat'] });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: { gateway: unknown } };
    expect(args.providerOptions).toEqual({
      gateway: { user: 'user_123', tags: ['route:chat'], models: [GATEWAY_MODEL_FAST], caching: 'auto' },
    });
  });

  it('ignores an empty tags array (does not emit an empty gateway.tags field)', () => {
    createSpawnforgeAgent({ ...gatewayBase, tags: [] });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: { gateway: Record<string, unknown> } };
    expect(args.providerOptions?.gateway).not.toHaveProperty('tags');
  });

  it.each([
    [GATEWAY_MODEL_PREMIUM, [GATEWAY_MODEL_CHAT, GATEWAY_MODEL_FAST]],
    [GATEWAY_MODEL_CHAT, [GATEWAY_MODEL_FAST]],
  ])('emits the ordered fallback list for %s (#9631)', (model, models) => {
    createSpawnforgeAgent({ ...gatewayBase, model });
    const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: { gateway: unknown } };
    expect(args.providerOptions).toEqual({ gateway: { models, caching: 'auto' } });
  });

  it('emits no fallback list for the cheapest model or an unknown provider model', () => {
    for (const model of [GATEWAY_MODEL_FAST, 'openai/gpt-4o-mini']) {
      mockToolLoopAgent.mockClear();
      createSpawnforgeAgent({ ...gatewayBase, model });
      const args = mockToolLoopAgent.mock.calls[0][0] as { providerOptions?: { gateway: unknown } };
      expect(args.providerOptions).toEqual({ gateway: { caching: 'auto' } });
    }
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
      anthropic: { thinking: { type: 'adaptive' } },
    });
  });
});
