/**
 * Tests for the decomposer's structured-output seam (PF-1216 / #9339).
 *
 * What matters here is that the model is asked for a schema-validated OBJECT
 * rather than prose, that the provider is chosen by the same registry rule the
 * streaming path uses, and that a missing backend fails loudly instead of
 * producing an unusable call.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const mockGenerateText = vi.fn();
const mockOutputObject = vi.fn((cfg: unknown) => ({ __output: cfg }));

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    generateText: (...args: unknown[]) => mockGenerateText(...args),
    Output: { object: (cfg: unknown) => mockOutputObject(cfg) },
  };
});

vi.mock('@/lib/providers/registry', () => ({
  resolveBackendWithCircuitBreaker: vi.fn(),
}));

vi.mock('@/lib/ai/aiSdkAdapter', () => ({
  resolveModelInstance: vi.fn(() => 'MODEL_INSTANCE'),
}));

import { generateDecomposition } from '@/lib/game-creation/decomposerLlm';
import { resolveBackendWithCircuitBreaker } from '@/lib/providers/registry';
import { resolveModelInstance } from '@/lib/ai/aiSdkAdapter';
import { AI_MODEL_PRIMARY } from '@/lib/ai/models';

const schema = z.object({ title: z.string() });

const directRoute = { backendId: 'direct' as const, apiKey: 'sk-ant-test', metered: true };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveBackendWithCircuitBreaker).mockReturnValue(directRoute);
  vi.mocked(resolveModelInstance).mockReturnValue('MODEL_INSTANCE' as never);
  mockGenerateText.mockResolvedValue({ output: { title: 'Test Game' } });
});

describe('generateDecomposition', () => {
  it('returns the provider-validated object', async () => {
    await expect(
      generateDecomposition('user turn', 'system prompt', schema),
    ).resolves.toEqual({ title: 'Test Game' });
  });

  it('asks for structured output built from the caller schema', async () => {
    await generateDecomposition('user turn', 'system prompt', schema);

    // If `output` is ever dropped the model answers with free text and the
    // caller is back to stripping markdown fences.
    expect(mockOutputObject).toHaveBeenCalledWith({ schema });
    const args = mockGenerateText.mock.calls[0][0] as Record<string, unknown>;
    expect(args.output).toEqual({ __output: { schema } });
    expect(args.system).toBe('system prompt');
    expect(args.prompt).toBe('user turn');
  });

  it('resolves the model through the same circuit-breaker-aware rule as the streaming path', async () => {
    await generateDecomposition('user turn', 'system prompt', schema);

    expect(resolveBackendWithCircuitBreaker).toHaveBeenCalledWith('chat', AI_MODEL_PRIMARY);
    expect(resolveModelInstance).toHaveBeenCalledWith(directRoute, AI_MODEL_PRIMARY);
    const args = mockGenerateText.mock.calls[0][0] as Record<string, unknown>;
    expect(args.model).toBe('MODEL_INSTANCE');
  });

  it('throws without calling the provider when no backend is configured', async () => {
    vi.mocked(resolveBackendWithCircuitBreaker).mockReturnValue(null);

    await expect(
      generateDecomposition('user turn', 'system prompt', schema),
    ).rejects.toThrow(/No chat backend is configured/);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('propagates a provider failure to the caller retry loop', async () => {
    mockGenerateText.mockRejectedValue(new Error('No object generated'));

    await expect(
      generateDecomposition('user turn', 'system prompt', schema),
    ).rejects.toThrow('No object generated');
  });
});
