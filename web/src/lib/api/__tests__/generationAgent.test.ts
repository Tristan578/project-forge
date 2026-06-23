/**
 * Unit tests for the generation agent runner (PF-916).
 *
 * The runner is an honest single-step executor: it races a single provider
 * `step` against a wall-clock `AbortSignal` deadline and passes the result
 * through untouched. There is no multi-step loop — one provider call IS the
 * whole job — so there is no step ledger, no `stepCountIs`, and no step-cap
 * error. These tests pin:
 *   - success passes the step result through untouched (contract preservation),
 *   - the step receives a real abort signal,
 *   - the timeout aborts the step deterministically and rejects with a typed error,
 *   - a step error rethrows untouched (so the factory's refund path runs),
 *   - an invalid timeout is rejected,
 *   - the feature flag defaults OFF.
 *
 * Timing is driven through the injected `scheduler` seam so there are no real
 * wall-clock waits — the timeout race is fully deterministic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  runGenerationAgent,
  isGenerationAgentEnabled,
  GenerationTimeoutError,
} from '../generationAgent';

/**
 * A controllable scheduler: timers don't fire until `flush()` is called, so a
 * test can decide whether the step or the timeout wins the race.
 */
function makeScheduler() {
  const timers = new Map<number, () => void>();
  let nextId = 1;
  return {
    scheduler: {
      setTimeout: (cb: () => void) => {
        const id = nextId++;
        timers.set(id, cb);
        return id;
      },
      clearTimeout: (handle: unknown) => {
        timers.delete(handle as number);
      },
    },
    /** Fire all pending timers (simulate the deadline elapsing). */
    flush: () => {
      for (const cb of timers.values()) cb();
      timers.clear();
    },
    pending: () => timers.size,
  };
}

describe('runGenerationAgent — success path', () => {
  it('passes the step result through untouched', async () => {
    const { scheduler } = makeScheduler();
    const payload = { jobId: 'meshy-1', usageId: 'usage-1', provider: 'meshy' };
    const result = await runGenerationAgent({
      step: async () => payload,
      scheduler,
    });
    expect(result).toBe(payload);
  });

  it('provides the step a non-aborted AbortSignal', async () => {
    const { scheduler } = makeScheduler();
    let seenSignal: AbortSignal | undefined;
    await runGenerationAgent({
      step: async ({ signal }) => {
        seenSignal = signal;
        return 'ok';
      },
      scheduler,
    });
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenSignal?.aborted).toBe(false);
  });

  it('runs the provider step exactly once (single-step, no loop)', async () => {
    const { scheduler } = makeScheduler();
    const step = vi.fn(async () => 'done');
    await runGenerationAgent({ step, scheduler });
    expect(step).toHaveBeenCalledTimes(1);
  });

  it('clears the timeout after the step settles (no leaked timer)', async () => {
    const sched = makeScheduler();
    await runGenerationAgent({ step: async () => 'done', scheduler: sched.scheduler });
    expect(sched.pending()).toBe(0);
  });
});

describe('runGenerationAgent — timeout cap', () => {
  it('aborts the step and rejects with GenerationTimeoutError when the deadline fires', async () => {
    const sched = makeScheduler();
    let abortedDuringStep = false;

    const promise = runGenerationAgent({
      timeoutMs: 1000,
      step: ({ signal }) =>
        new Promise<string>((_resolve, reject) => {
          // Never resolves on its own — only the timeout can settle this.
          signal.addEventListener('abort', () => {
            abortedDuringStep = true;
            reject(new Error('aborted'));
          });
        }),
      scheduler: sched.scheduler,
    });

    // Fire the deadline.
    sched.flush();

    await expect(promise).rejects.toBeInstanceOf(GenerationTimeoutError);
    expect(abortedDuringStep).toBe(true);
    await promise.catch((err: GenerationTimeoutError) => {
      expect(err.timeoutMs).toBe(1000);
    });
  });

  it('arms the timer with the supplied timeoutMs', async () => {
    const armedMs: number[] = [];
    const scheduler = {
      setTimeout: (_cb: () => void, ms: number) => {
        armedMs.push(ms);
        return 1;
      },
      clearTimeout: () => {},
    };
    await runGenerationAgent({ step: async () => 'ok', timeoutMs: 42_000, scheduler });
    expect(armedMs).toEqual([42_000]);
  });

  it('an already-aborted external signal aborts the step deterministically', async () => {
    const { scheduler } = makeScheduler();
    const controller = new AbortController();
    controller.abort();

    const stepRan = vi.fn();
    const promise = runGenerationAgent({
      externalSignal: controller.signal,
      step: async () => {
        stepRan();
        return 'should-not-run';
      },
      scheduler,
    });

    await expect(promise).rejects.toBeInstanceOf(GenerationTimeoutError);
    expect(stepRan).not.toHaveBeenCalled();
  });
});

describe('runGenerationAgent — failure passthrough', () => {
  it('rethrows a provider error untouched so the factory refund path runs', async () => {
    const { scheduler } = makeScheduler();
    const providerError = new Error('Provider down');
    const promise = runGenerationAgent({
      step: async () => {
        throw providerError;
      },
      scheduler,
    });
    await expect(promise).rejects.toBe(providerError);
  });
});

describe('runGenerationAgent — timeout validation', () => {
  it('rejects a non-positive or non-finite timeoutMs', async () => {
    const { scheduler } = makeScheduler();
    await expect(
      runGenerationAgent({ step: async () => 'x', timeoutMs: 0, scheduler }),
    ).rejects.toThrow(/positive finite/);
    await expect(
      runGenerationAgent({ step: async () => 'x', timeoutMs: -1, scheduler }),
    ).rejects.toThrow(/positive finite/);
    await expect(
      runGenerationAgent({ step: async () => 'x', timeoutMs: Number.NaN, scheduler }),
    ).rejects.toThrow(/positive finite/);
  });
});

describe('isGenerationAgentEnabled — feature flag', () => {
  const original = process.env.USE_GENERATION_AGENT;
  beforeEach(() => {
    delete process.env.USE_GENERATION_AGENT;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.USE_GENERATION_AGENT;
    else process.env.USE_GENERATION_AGENT = original;
  });

  it('defaults OFF when the env var is absent', () => {
    expect(isGenerationAgentEnabled()).toBe(false);
  });

  it('is OFF for any value other than the exact string "true"', () => {
    process.env.USE_GENERATION_AGENT = 'TRUE';
    expect(isGenerationAgentEnabled()).toBe(false);
    process.env.USE_GENERATION_AGENT = '1';
    expect(isGenerationAgentEnabled()).toBe(false);
    process.env.USE_GENERATION_AGENT = 'yes';
    expect(isGenerationAgentEnabled()).toBe(false);
  });

  it('is ON only for the exact string "true"', () => {
    process.env.USE_GENERATION_AGENT = 'true';
    expect(isGenerationAgentEnabled()).toBe(true);
  });
});
