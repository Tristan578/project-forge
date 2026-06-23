/**
 * Generation agent runner (PF-916).
 *
 * Retires the `createGenerationHandler` single point of failure by routing the
 * provider call through a runner with one deterministic termination guarantee:
 *
 *   **Timeout cap** — the provider step races against a hard wall-clock deadline
 *   using an `AbortSignal` (the SDK's native cancellation primitive). A hung
 *   provider call aborts before the function `maxDuration` so the caller's
 *   refund path still runs while the function is alive.
 *
 * Why a single honest step and not a multi-step loop: the generate routes'
 * `execute` is a single deterministic provider HTTP call (ElevenLabs / Meshy /
 * Replicate / Suno), NOT an LLM tool loop. One provider call IS the whole job —
 * there is no second step to take, no intermediate state to carry, and no
 * `model` + `tools` to drive. Wrapping a deterministic provider call in a
 * `ToolLoopAgent` would invent a fake model, add LLM cost where there is none,
 * and change the response semantics; spinning it in a `stepCountIs`-bounded
 * loop would add machinery that provably never iterates. So this runner is an
 * honest single-step executor: it adopts only the SDK's cancellation primitive
 * (`AbortSignal`) — exactly what caps the SPOF — while preserving the existing
 * single-call contract byte-for-byte. If a route ever grows a genuine
 * multi-step LLM loop, that belongs in a real `ToolLoopAgent`, not here.
 *
 * The runner is INTERNAL to `createGenerationHandler`; it never touches auth,
 * rate limiting, billing, or the response shape. The factory keeps owning
 * `usageId` resolution and refund-on-failure, so the async-refund contract is
 * unchanged regardless of which path runs.
 */

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

/** The generation provider call. Receives an abort signal it MUST honor. */
export type GenerationStep<TResult> = (ctx: {
  /** Abort signal wired to the wall-clock deadline. Forward to fetch/provider clients. */
  signal: AbortSignal;
}) => Promise<TResult>;

export interface RunGenerationAgentOptions<TResult> {
  /** The provider call, run as one agent step. */
  step: GenerationStep<TResult>;
  /**
   * Wall-clock cap in milliseconds for the provider step. Defaults to the
   * centralized base cap. Callers SHOULD derive this from the route's
   * `maxDuration` via `deriveGenerationStepTimeoutMs` so the abort is
   * enforceable on that specific route.
   */
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
 * Race the provider step against its wall-clock deadline. Aborts the step's
 * signal on timeout (or when the external signal aborts) and rejects with
 * `GenerationTimeoutError`. The step's own promise wins if it settles first.
 */
function runStepWithTimeout<TResult>(
  step: GenerationStep<TResult>,
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
    return step({ signal: controller.signal });
  })();

  return Promise.race([stepPromise, timeoutPromise]).finally(() => {
    scheduler.clearTimeout(timer);
  }) as Promise<TResult>;
}

/**
 * Run a generation provider call through the deterministic agent.
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
    timeoutMs = GENERATION_AGENT_STEP_TIMEOUT_MS,
    externalSignal,
    scheduler = {
      setTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
  } = options;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`timeoutMs must be a positive finite number, got ${timeoutMs}`);
  }

  // One provider call IS the whole job — run it as a single timed step.
  return runStepWithTimeout(step, timeoutMs, externalSignal, scheduler);
}

/**
 * True when generate routes should run through the agent instead of the legacy
 * inline `execute`. Defaults OFF so the existing factory path is the default
 * until the agent is validated in production.
 *
 * Mirrors the `hasValidClerkKey` guard pattern: absent / any-non-"true" value
 * leaves the flag off, so a missing env var can never break CI or prod.
 */
export function isGenerationAgentEnabled(): boolean {
  return process.env.USE_GENERATION_AGENT === 'true';
}
