/**
 * Tests for createSpawnforgeAgent — verify providerOptions construction.
 *
 * Mocks ToolLoopAgent so we can assert the exact constructor args without
 * spinning up a real agent. The shape of providerOptions is the contract that
 * non-chat generators rely on (effort field) and that the chat route relies on
 * (thinking field), so it's the right surface to test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockToolLoopAgent = vi.fn();

vi.mock('ai', () => ({
  ToolLoopAgent: class {
    constructor(args: unknown) {
      mockToolLoopAgent(args);
    }
  },
  stepCountIs: vi.fn((n: number) => ({ _stop: 'stepCount', n })),
}));

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

import { createSpawnforgeAgent } from '@/lib/ai/spawnforgeAgent';

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
