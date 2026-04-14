import { describe, it, expect } from 'vitest';
import { planPresentExecutor } from '../planPresentExecutor';

describe('planPresentExecutor', () => {
  it('has correct name and error message', () => {
    expect(planPresentExecutor.name).toBe('plan_present');
    expect(planPresentExecutor.userFacingErrorMessage).toContain('plan summary');
  });

  it('passes through valid plan summary data', async () => {
    const input = {
      sceneCount: 3,
      systemCount: 7,
      entityCount: 12,
    };

    const result = await planPresentExecutor.execute(input, {} as never);

    expect(result.success).toBe(true);
    expect(result.output?.sceneCount).toBe(3);
    expect(result.output?.systemCount).toBe(7);
    expect(result.output?.entityCount).toBe(12);
  });

  it('preserves extra fields via passthrough', async () => {
    const input = {
      sceneCount: 1,
      systemCount: 2,
      entityCount: 5,
      title: 'My Game',
      estimatedTokens: 500,
    };

    const result = await planPresentExecutor.execute(input, {} as never);

    expect(result.success).toBe(true);
    expect(result.output?.title).toBe('My Game');
    expect(result.output?.estimatedTokens).toBe(500);
  });

  it('returns input as-is when validation fails', async () => {
    const input = {
      sceneCount: 'not a number',
      systemCount: 2,
      entityCount: 5,
    };

    const result = await planPresentExecutor.execute(input, {} as never);

    // planPresentExecutor always returns success, even on invalid input
    expect(result.success).toBe(true);
    expect(result.output?.sceneCount).toBe('not a number');
  });

  it('handles empty input', async () => {
    const result = await planPresentExecutor.execute({}, {} as never);

    expect(result.success).toBe(true);
  });

  it('handles zero counts', async () => {
    const input = {
      sceneCount: 0,
      systemCount: 0,
      entityCount: 0,
    };

    const result = await planPresentExecutor.execute(input, {} as never);

    expect(result.success).toBe(true);
    expect(result.output?.sceneCount).toBe(0);
  });
});
