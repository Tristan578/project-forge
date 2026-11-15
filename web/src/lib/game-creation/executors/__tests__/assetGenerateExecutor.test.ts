import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assetGenerateExecutor } from '../assetGenerateExecutor';
import type { ExecutorContext } from '../../types';

/**
 * Generation remains unavailable until a generated artifact can be persisted,
 * attached and billed safely (#9900 / #9808). An unverified fallback is only
 * diagnostic data; it must never make the step successful.
 */
function makeCtx(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return {
    dispatchCommand: vi.fn(),
    getStore: vi.fn(() => { throw new Error('Unavailable generation must not access the editor store'); }),
    projectType: '3d',
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn(),
    resolveStepOutputs: vi.fn(() => []),
    ...overrides,
  };
}

const validInput = {
  type: 'sound',
  description: 'a crate breaking',
  styleDirective: '8-bit',
  priority: 'required',
  fallback: 'builtin:sfx-default',
};

describe('assetGenerateExecutor', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockRejectedValue(new Error('Unexpected network request'));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains that generation is unavailable and gives actionable next steps', () => {
    expect(assetGenerateExecutor.name).toBe('asset_generate');
    expect(assetGenerateExecutor.userFacingErrorMessage).toMatch(/generation.*not available/i);
    expect(assetGenerateExecutor.userFacingErrorMessage).toMatch(/add assets manually/i);
    expect(assetGenerateExecutor.userFacingErrorMessage).toMatch(/select start over/i);
    expect(assetGenerateExecutor.userFacingErrorMessage).not.toMatch(/using a placeholder/i);
  });

  it.each(['3d-model', 'texture', 'sound', 'music', 'voice', 'sprite'])(
    'refuses %s generation on repeated calls without fabricating or attaching an asset',
    async (type) => {
      const ctx = makeCtx();
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await assetGenerateExecutor.execute({ ...validInput, type }, ctx);
        expect(result.success).toBe(false);
        expect(result.error).toMatchObject({
          code: 'ASSET_GENERATION_UNAVAILABLE',
          retryable: false,
          userFacingMessage: assetGenerateExecutor.userFacingErrorMessage,
        });
        expect(result.output).toEqual({
          unsupported: true,
          pending: true,
          assetType: type,
          fallbackAssetId: 'builtin:sfx-default',
        });
        expect(result.output).not.toHaveProperty('warning');
      }
      expect(ctx.dispatchCommand).not.toHaveBeenCalled();
      expect(ctx.getStore).not.toHaveBeenCalled();
    },
  );

  it('returns nonretryable cancellation instead of a successful fallback', async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = makeCtx({ signal: controller.signal });
    const result = await assetGenerateExecutor.execute(validInput, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: 'CANCELLED', retryable: false });
    expect(result.output).toBeUndefined();
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown asset type', { type: 'video' }],
    ['empty description', { description: '' }],
    ['description over 500 characters', { description: 'x'.repeat(501) }],
    ['invalid priority', { priority: 'critical' }],
    ['duration below 0.5 seconds', { durationSeconds: 0.4 }],
    ['duration above 22 seconds', { durationSeconds: 60 }],
    ['style directive over 500 characters', { styleDirective: 'x'.repeat(501) }],
  ] as const)('rejects %s before returning generation diagnostics', async (_label, invalidFields) => {
    const ctx = makeCtx();
    const result = await assetGenerateExecutor.execute({ ...validInput, ...invalidFields }, ctx);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(result.output).toBeUndefined();
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
  });

  it.each(['invalid-fallback', 'primitive:Stone'])(
    'rejects invalid fallback %s instead of presenting it as an available asset',
    async (fallback) => {
      const ctx = makeCtx();
      const result = await assetGenerateExecutor.execute({ ...validInput, fallback }, ctx);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_FALLBACK');
      expect(result.output).toBeUndefined();
      expect(ctx.dispatchCommand).not.toHaveBeenCalled();
    },
  );

  it.each(['primitive:cube', 'builtin:footstep-default'])(
    'retains valid fallback %s only as diagnostic data',
    async (fallback) => {
      const result = await assetGenerateExecutor.execute({ ...validInput, fallback }, makeCtx());
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ASSET_GENERATION_UNAVAILABLE');
      expect(result.output?.fallbackAssetId).toBe(fallback);
      expect(result.output).not.toHaveProperty('assetId');
      expect(result.output).not.toHaveProperty('usedFallback');
      expect(result.output).not.toHaveProperty('audioBase64');
    },
  );
});
