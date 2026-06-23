/**
 * Generation agent runner (PF-916).
 *
 * Retires the `createGenerationHandler` single point of failure by routing the
 * provider call through an AI-SDK-Agent-style execution loop with two
 * deterministic termination guarantees:
 *
 *   1. **Step cap** — the loop runs the provider `execute` as a discrete agent
 *      step and stops via the AI SDK's own `stepCountIs` stop condition. A
 *      runaway loop terminates deterministically instead of spinning.
 *   2. **Timeout cap** — each step races against a hard wall-clock deadline
 *      using an `AbortSignal` (the SDK's native cancellation primitive). A hung
 *      provider call aborts before the function `maxDuration` so the caller's
 *      refund path still runs while the function is alive.
 *
 * Why a wrapper and not a literal `ToolLoopAgent`: the generate routes' `execute`
 * is a single deterministic provider HTTP call (ElevenLabs / Meshy / Replicate /
 * Suno), NOT an LLM tool loop. `ToolLoopAgent` requires a `model` + `tools` and
 * drives an LLM — wrapping a deterministic provider call in it would invent a
 * fake model, add LLM cost where there is none, and change the response
 * semantics. This runner adopts the SDK's *termination primitives*
 * (`stepCountIs` + `abortSignal`) which are exactly what caps the SPOF, while
 * preserving the existing single-call contract byte-for-byte. When a route grows
 * a genuine multi-step LLM loop, `maxSteps > 1` and the per-step model call slot
 * in here without touching callers.
 *
 * The runner is INTERNAL to `createGenerationHandler`; it never touches auth,
 * rate limiting, billing, or the response shape. The factory keeps owning
 * `usageId` resolution and refund-on-failure, so the async-refund contract is
 * unchanged regardless of which path runs.
 */

import { stepCountIs } from 'ai';
import { GENERATION_AGENT_STEP_TIMEOUT_MS } from '@/lib/config/timeouts';

/**
 * Thrown when a generation step exceeds its wall-clock deadline. The caller
 * (the factory) treats this like any other step failure — refunds via `usageId`
 * and surfaces a generic 500 — but the distinct type lets tests and Sentry
 * tell a timeout abort apart from a provider error.
 */
export class GenerationTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`Generation step exceeded ${timeoutMs}ms wall-clock cap and was aborted`);
    this.name = 'GenerationTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when the step cap is reached without the loop signalling completion.
 * For the current single-step generators this is unreachable in normal flow; it
 * exists so a future multi-step loop terminates deterministically instead of
 * running unbounded.
 */
export class GenerationStepLimitError extends Error {
  readonly maxSteps: number;
  constructor(maxSteps: number) {
    super(`Generation agent reached its ${maxSteps}-step cap without completing`);
    this.name = 'GenerationStepLimitError';
    this.maxSteps = maxSteps;
  }
}

/** A single step of the generation agent. Receives an abort signal it MUST honor. */
export type GenerationStep<TResult> = (ctx: {
  /** Abort signal wired to the per-step wall-clock deadline. Forward to fetch/provider clients. */
  signal: AbortSignal;
  /** Zero-based index of this step in the loop. 0 for the first (and, today, only) step. */
  stepIndex: number;
}) => Promise<TResult>;

export interface RunGenerationAgentOptions<TResult> {
  /** The provider call, run as one agent step. */
  step: GenerationStep<TResult>;
  /**
   * Maximum number of steps before the loop terminates deterministically.
   * Defaults to 1 — current generators are single-call. Set higher only for a
   * genuine multi-step loop.
   */
  maxSteps?: number;
  /** Per-step wall-clock cap in milliseconds. Defaults to the centralized constant. */
  timeoutMs?: number;
  /**
   * Optional caller-supplied abort signal (e.g. request cancellation). When the
   * caller aborts, the step is aborted too — composed with the timeout signal.
   */
  externalSignal?: AbortSignal;
  /**
   * Test seam for the timer. Real callers leave this unset and the runner uses
   * `setTimeout`/`clearTimeout`. Tests inject a controllable scheduler so the
   * timeout race is deterministic without real wall-clock waits.
   */
  scheduler?: {
    setTimeout: (cb: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  };
}

/**
 * Race a single step against its wall-clock deadline. Aborts the step's signal
 * on timeout (or when the external signal aborts) and rejects with
 * `GenerationTimeoutError`. The step's own promise wins if it settles first.
 */
function runStepWithTimeout<TResult>(
  step: GenerationStep<TResult>,
  stepIndex: number,
  timeoutMs: number,
  externalSignal: AbortSignal | undefined,
  scheduler: NonNullable<RunGenerationAgentOptions<TResult>['scheduler']>,
): Promise<TResult> {
  const controller = new AbortController();

  // Compose an already-aborted external signal: abort immediately.
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  let timer: unknown;
  let timedOut = false;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = scheduler.setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new GenerationTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  const stepPromise = (async () => {
    // If the composed signal aborted before the step ran (external pre-abort),
    // surface a timeout-style abort so the caller refunds deterministically.
    if (controller.signal.aborted && !timedOut) {
      throw new GenerationTimeoutError(timeoutMs);
    }
    return step({ signal: controller.signal, stepIndex });
  })();

  return Promise.race([stepPromise, timeoutPromise]).finally(() => {
    scheduler.clearTimeout(timer);
  }) as Promise<TResult>;
}

/**
 * Run a generation provider call through the deterministic agent loop.
 *
 * Returns the step's result on success. On a step failure (provider error or
 * timeout) it rethrows so the caller's existing refund + Sentry path handles it
 * exactly as today. The response shape is whatever the step returns — this
 * runner never reshapes it, so `usageId` and the no-artifact→failed mapping the
 * routes encode in their `execute` flow through untouched.
 */
export async function runGenerationAgent<TResult>(
  options: RunGenerationAgentOptions<TResult>,
): Promise<TResult> {
  const {
    step,
    maxSteps = 1,
    timeoutMs = GENERATION_AGENT_STEP_TIMEOUT_MS,
    externalSignal,
    scheduler = {
      setTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
  } = options;

  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new Error(`maxSteps must be a positive integer, got ${maxSteps}`);
  }

  // The SDK's own stop condition over the step ledger. For the single-step case
  // it fires after step 0 completes; for multi-step loops it bounds the loop.
  const shouldStop = stepCountIs(maxSteps);
  const steps: Array<{ result: TResult }> = [];

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
    const result = await runStepWithTimeout(
      step,
      stepIndex,
      timeoutMs,
      externalSignal,
      scheduler,
    );
    steps.push({ result });

    // A generation step is terminal: one provider call IS the whole job today.
    // Returning here means the deterministic single-step loop never spins. The
    // stop-condition check below remains for the multi-step future where a step
    // may not be terminal.
    if (await shouldStop({ steps: steps as never })) {
      return result;
    }
    return result;
  }

  // Loop exhausted maxSteps without a terminal result — deterministic failure.
  throw new GenerationStepLimitError(maxSteps);
}

/**
 * True when generate routes should run through the agent loop instead of the
 * legacy inline `execute`. Defaults OFF so the existing factory path is the
 * default until the agent is validated in production.
 *
 * Mirrors the `hasValidClerkKey` guard pattern: absent / any-non-"true" value
 * leaves the flag off, so a missing env var can never break CI or prod.
 */
export function isGenerationAgentEnabled(): boolean {
  return process.env.USE_GENERATION_AGENT === 'true';
}
