import { describe, it, expect, vi } from 'vitest';
import { assetGenerateExecutor } from '../assetGenerateExecutor';
import type { ExecutorContext } from '../../types';

function makeCtx(overrides?: Partial<ExecutorContext>): ExecutorContext {
  return {
    dispatchCommand: vi.fn(),
    store: { sceneGraph: { nodes: {} } } as never,
    projectType: '3d',
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn(),
    ...overrides,
  };
}

describe('assetGenerateExecutor', () => {
  it('has correct name and error message', () => {
    expect(assetGenerateExecutor.name).toBe('asset_generate');
    expect(assetGenerateExecutor.userFacingErrorMessage).toContain('placeholder');
  });

  it('generates an asset successfully', async () => {
    const ctx = makeCtx();
    const result = await assetGenerateExecutor.execute({
      type: '3d-model',
      description: 'a medieval sword',
      styleDirective: 'low-poly fantasy',
      priority: 'required',
      fallback: 'primitive:cube',
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.usedFallback).toBe(false);
    expect(typeof result.output?.assetId).toBe('string');
    expect((result.output?.assetId as string).startsWith('asset_')).toBe(true);
  });

  it('uses fallback when signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const ctx = makeCtx({ signal: ac.signal });

    const result = await assetGenerateExecutor.execute({
      type: 'texture',
      description: 'stone texture',
      styleDirective: 'realistic',
      priority: 'nice-to-have',
      fallback: 'builtin:stone',
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.usedFallback).toBe(true);
    expect(result.output?.assetId).toBe('builtin:stone');
  });

  it('accepts all valid asset types', async () => {
    const types = ['3d-model', 'texture', 'sound', 'music', 'voice', 'sprite'] as const;

    for (const type of types) {
      const ctx = makeCtx();
      const result = await assetGenerateExecutor.execute({
        type,
        description: `test ${type}`,
        styleDirective: 'default',
        priority: 'required',
        fallback: 'primitive:default',
      }, ctx);

      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid asset type', async () => {
    const ctx = makeCtx();
    const result = await assetGenerateExecutor.execute({
      type: 'video',
      description: 'a cutscene',
      styleDirective: 'cinematic',
      priority: 'required',
      fallback: 'primitive:cube',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects empty description', async () => {
    const ctx = makeCtx();
    const result = await assetGenerateExecutor.execute({
      type: 'texture',
      description: '',
      styleDirective: 'pixel',
      priority: 'required',
      fallback: 'primitive:cube',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects description over 500 characters', async () => {
    const ctx = makeCtx();
    const result = await assetGenerateExecutor.execute({
      type: 'texture',
      description: 'x'.repeat(501),
      styleDirective: 'pixel',
      priority: 'required',
      fallback: 'primitive:cube',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects invalid priority', async () => {
    const ctx = makeCtx();
    const result = await assetGenerateExecutor.execute({
      type: 'sound',
      description: 'explosion',
      styleDirective: '8-bit',
      priority: 'critical',
      fallback: 'primitive:default',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects invalid fallback format', async () => {
    const ctx = makeCtx();
    const result = await assetGenerateExecutor.execute({
      type: 'texture',
      description: 'stone',
      styleDirective: 'realistic',
      priority: 'required',
      fallback: 'invalid-fallback',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_FALLBACK');
  });

  it('rejects fallback with uppercase letters', async () => {
    const ctx = makeCtx();
    const result = await assetGenerateExecutor.execute({
      type: 'texture',
      description: 'stone',
      styleDirective: 'realistic',
      priority: 'required',
      fallback: 'primitive:Stone',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_FALLBACK');
  });

  it('accepts builtin: prefix in fallback', async () => {
    const ctx = makeCtx();
    const result = await assetGenerateExecutor.execute({
      type: 'sound',
      description: 'footstep',
      styleDirective: 'realistic',
      priority: 'nice-to-have',
      fallback: 'builtin:footstep-default',
    }, ctx);

    expect(result.success).toBe(true);
  });

  it('generates unique asset IDs across calls', async () => {
    const ctx = makeCtx();
    const input = {
      type: 'texture' as const,
      description: 'test',
      styleDirective: 'default',
      priority: 'required' as const,
      fallback: 'primitive:cube',
    };

    const result1 = await assetGenerateExecutor.execute(input, ctx);
    const result2 = await assetGenerateExecutor.execute(input, ctx);

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    expect(result1.output?.assetId).not.toBe(result2.output?.assetId);
  });

  it('rejects styleDirective over 500 characters', async () => {
    const ctx = makeCtx();
    const result = await assetGenerateExecutor.execute({
      type: 'texture',
      description: 'stone',
      styleDirective: 'x'.repeat(501),
      priority: 'required',
      fallback: 'primitive:cube',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });
});
