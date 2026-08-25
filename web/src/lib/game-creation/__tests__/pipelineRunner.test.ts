/**
 * Tests for the pipeline runner — generic step executor with retry, abort, and
 * approval gate support.
 *
 * Uses simple mock executors; no external imports beyond vitest primitives.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import type {
  OrchestratorPlan,
  ExecutorDefinition,
  ExecutorContext,
  ExecutorResult,
  ExecutorName,
  ApprovalGate,
  OrchestratorGDD,
  TokenEstimate,
} from '@/lib/game-creation/types';
import { runPipeline } from '@/lib/game-creation/pipelineRunner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(overrides: Partial<OrchestratorPlan> = {}): OrchestratorPlan {
  const gdd: OrchestratorGDD = {
    id: 'gdd-1',
    title: 'Test Game',
    description: 'A test game',
    systems: [],
    scenes: [],
    assetManifest: [],
    estimatedScope: 'small',
    styleDirective: '',
    feelDirective: {
      mood: 'neutral',
      pacing: 'medium',
      weight: 'medium',
      referenceGames: [],
      oneLiner: '',
    },
    constraints: [],
    projectType: '2d',
  };

  const tokenEstimate: TokenEstimate = {
    breakdown: [],
    totalEstimated: 0,
    totalVarianceHigh: 0,
    totalVarianceLow: 0,
    userTier: 'starter',
    sufficientBalance: true,
  };

  return {
    id: 'plan-1',
    projectId: 'proj-1',
    prompt: 'Make a game',
    gdd,
    steps: [],
    approvalGates: [],
    tokenEstimate,
    status: 'executing',
    currentStepIndex: 0,
    createdAt: 0,
    ...overrides,
  };
}

function makeStep(
  id: string,
  executor: 'scene_create' | 'physics_profile' | 'verify_all_scenes' | 'physics_enable' = 'scene_create',
  overrides: Partial<OrchestratorPlan['steps'][number]> = {},
): OrchestratorPlan['steps'][number] {
  return {
    id,
    executor,
    input: {},
    dependsOn: [],
    maxRetries: 0,
    optional: false,
    status: 'pending',
    ...overrides,
  };
}

function makeGate(id: string, afterStepId: string, overrides: Partial<ApprovalGate> = {}): ApprovalGate {
  return {
    id,
    label: 'Review',
    description: 'Please review',
    afterStepId,
    status: 'pending',
    displayData: {},
    ...overrides,
  };
}

function makeContext(
  signal: AbortSignal,
  resolveStepOutput?: (id: string) => Record<string, unknown> | undefined,
  resolveStepOutputs?: (executorName: string) => Record<string, unknown>[],
): ExecutorContext {
  const store = {} as ReturnType<ExecutorContext['getStore']>;
  const ctx: ExecutorContext = {
    dispatchCommand: vi.fn(),
    getStore: () => store,
    projectType: '2d',
    userTier: 'starter',
    signal,
    resolveStepOutput: resolveStepOutput ?? (() => undefined),
    resolveStepOutputs: resolveStepOutputs ?? (() => []),
  };
  return ctx;
}

const successExecutor: ExecutorDefinition = {
  name: 'scene_create',
  inputSchema: z.object({}),
  execute: async (): Promise<ExecutorResult> => ({ success: true, output: { created: true } }),
  userFacingErrorMessage: 'Scene creation failed',
};

const failureExecutor: ExecutorDefinition = {
  name: 'physics_profile',
  inputSchema: z.object({}),
  execute: async (): Promise<ExecutorResult> => ({
    success: false,
    error: { code: 'ERR', message: 'physics failed', userFacingMessage: 'Physics failed', retryable: false },
  }),
  userFacingErrorMessage: 'Physics failed',
};

const verifyExecutor: ExecutorDefinition = {
  name: 'verify_all_scenes',
  inputSchema: z.object({}),
  execute: async (): Promise<ExecutorResult> => ({ success: true, output: { verified: true } }),
  userFacingErrorMessage: 'Verify failed',
};

function makeRegistry(...defs: ExecutorDefinition[]): Map<ExecutorName, ExecutorDefinition> {
  const map = new Map<ExecutorName, ExecutorDefinition>();
  for (const def of defs) {
    map.set(def.name, def);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runPipeline', () => {
  let controller: AbortController;

  beforeEach(() => {
    controller = new AbortController();
  });

  it('completes immediately for an empty plan', async () => {
    const plan = makePlan({ steps: [], status: 'executing' });
    const ctx = makeContext(controller.signal);
    const result = await runPipeline(plan, makeRegistry(successExecutor), ctx);
    expect(result.status).toBe('completed');
  });

  it('executes steps in array order', async () => {
    const order: string[] = [];
    const orderedRegistry = new Map<ExecutorName, ExecutorDefinition>([
      ['scene_create', {
        name: 'scene_create',
        inputSchema: z.object({}),
        execute: async (): Promise<ExecutorResult> => { order.push('step_0'); return { success: true, output: {} }; },
        userFacingErrorMessage: '',
      }],
      ['verify_all_scenes', {
        name: 'verify_all_scenes',
        inputSchema: z.object({}),
        execute: async (): Promise<ExecutorResult> => { order.push('step_1'); return { success: true, output: {} }; },
        userFacingErrorMessage: '',
      }],
    ]);

    const plan = makePlan({
      steps: [makeStep('step_0', 'scene_create'), makeStep('step_1', 'verify_all_scenes')],
    });
    const ctx = makeContext(controller.signal);
    await runPipeline(plan, orderedRegistry, ctx);
    expect(order).toEqual(['step_0', 'step_1']);
  });

  it('marks plan as completed when all steps succeed', async () => {
    const plan = makePlan({ steps: [makeStep('step_0')] });
    const ctx = makeContext(controller.signal);
    const result = await runPipeline(plan, makeRegistry(successExecutor), ctx);
    expect(result.status).toBe('completed');
    expect(result.steps[0].status).toBe('completed');
  });

  it('transitions step status: pending -> running -> completed', async () => {
    const statuses: string[] = [];
    const trackingRegistry = new Map<ExecutorName, ExecutorDefinition>([
      ['scene_create', {
        name: 'scene_create',
        inputSchema: z.object({}),
        execute: async (_input, ctx): Promise<ExecutorResult> => {
          // We can only observe running inside execute; but the step object is mutated
          void ctx; // ctx not used here — just track via callback
          return { success: true, output: {} };
        },
        userFacingErrorMessage: '',
      }],
    ]);

    const plan = makePlan({ steps: [makeStep('step_0')] });
    const ctx = makeContext(controller.signal);

    const callbacks = {
      onStepComplete: (_stepId: string, _result: ExecutorResult) => {
        statuses.push(plan.steps[0].status);
      },
    };

    await runPipeline(plan, trackingRegistry, ctx, callbacks);
    // After complete callback fires, status should be completed
    expect(statuses).toContain('completed');
  });

  it('retries a failing step up to maxRetries times', async () => {
    let callCount = 0;
    const flakyRegistry = new Map<ExecutorName, ExecutorDefinition>([
      ['scene_create', {
        name: 'scene_create',
        inputSchema: z.object({}),
        execute: async (): Promise<ExecutorResult> => {
          callCount++;
          if (callCount < 3) {
            return { success: false, error: { code: 'FLAKY', message: 'flaky', userFacingMessage: 'Flaky', retryable: true } };
          }
          return { success: true, output: { recovered: true } };
        },
        userFacingErrorMessage: 'Flaky failed',
      }],
    ]);

    const plan = makePlan({ steps: [makeStep('step_0', 'scene_create', { maxRetries: 3 })] });
    const ctx = makeContext(controller.signal);
    const result = await runPipeline(plan, flakyRegistry, ctx);

    expect(callCount).toBe(3); // 2 failures then 1 success
    expect(result.status).toBe('completed');
    expect(result.steps[0].status).toBe('completed');
  });

  it('marks plan as failed when non-optional step exhausts all retries', async () => {
    const plan = makePlan({ steps: [makeStep('step_0', 'physics_profile', { maxRetries: 2 })] });
    const ctx = makeContext(controller.signal);
    const result = await runPipeline(plan, makeRegistry(failureExecutor), ctx);
    expect(result.status).toBe('failed');
    expect(result.steps[0].status).toBe('failed');
  });

  it('skips optional step on failure and continues execution', async () => {
    const plan = makePlan({
      steps: [
        makeStep('step_0', 'physics_profile', { optional: true }),
        makeStep('step_1', 'verify_all_scenes'),
      ],
    });
    const ctx = makeContext(controller.signal);
    const result = await runPipeline(
      plan,
      makeRegistry(failureExecutor, verifyExecutor),
      ctx,
    );
    expect(result.steps[0].status).toBe('skipped');
    expect(result.steps[1].status).toBe('completed');
    expect(result.status).toBe('completed');
  });

  it('skips steps whose dependsOn step has failed', async () => {
    const plan = makePlan({
      steps: [
        makeStep('step_0', 'physics_profile'), // fails
        makeStep('step_1', 'verify_all_scenes', { dependsOn: ['step_0'] }), // should be skipped
      ],
    });
    const ctx = makeContext(controller.signal);
    const result = await runPipeline(plan, makeRegistry(failureExecutor, verifyExecutor), ctx);
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[1].status).toBe('skipped');
    expect(result.status).toBe('failed');
  });

  it('fails plan when non-optional step depends on a skipped optional step', async () => {
    // step_0 uses physics_profile (failureExecutor), is optional -> skipped
    // step_1 is non-optional and depends on step_0 -> DEPENDENCY_FAILED
    const plan = makePlan({
      steps: [
        { ...makeStep('step_0', 'physics_profile'), optional: true },
        { ...makeStep('step_1', 'verify_all_scenes'), dependsOn: ['step_0'] },
      ],
    });
    const ctx = makeContext(controller.signal);
    const result = await runPipeline(plan, makeRegistry(failureExecutor, verifyExecutor), ctx);

    expect(result.steps[0].status).toBe('skipped'); // optional failure -> skipped
    expect(result.steps[1].status).toBe('skipped'); // dependency unmet
    expect(result.steps[1].error?.code).toBe('DEPENDENCY_FAILED');
    expect(result.status).toBe('failed');
  });

  it('skips optional step with unmet dependencies without failing plan', async () => {
    // step_0 uses physics_profile (fails), is optional -> skipped
    // step_1 is optional and depends on step_0 -> skipped (no error, just optional skip)
    // step_2 has no deps, uses scene_create (succeeds) -> completed
    const plan = makePlan({
      steps: [
        { ...makeStep('step_0', 'physics_profile'), optional: true },
        { ...makeStep('step_1', 'verify_all_scenes'), dependsOn: ['step_0'], optional: true },
        makeStep('step_2', 'scene_create'), // no deps, should run
      ],
    });
    const ctx = makeContext(controller.signal);
    const result = await runPipeline(plan, makeRegistry(failureExecutor, verifyExecutor, successExecutor), ctx);

    expect(result.steps[0].status).toBe('skipped'); // optional failure
    expect(result.steps[1].status).toBe('skipped'); // optional dep unmet
    expect(result.steps[2].status).toBe('completed'); // independent, runs fine
    expect(result.status).toBe('completed');
  });

  it('fires onStepComplete callback after each step', async () => {
    const completed: string[] = [];
    const plan = makePlan({
      steps: [makeStep('step_0'), makeStep('step_1', 'verify_all_scenes')],
    });
    const ctx = makeContext(controller.signal);
    await runPipeline(plan, makeRegistry(successExecutor, verifyExecutor), ctx, {
      onStepComplete: (stepId) => { completed.push(stepId); },
    });
    expect(completed).toEqual(['step_0', 'step_1']);
  });

  it('pauses at an approval gate and resumes on approved callback', async () => {
    const gate = makeGate('gate-1', 'step_0');
    const plan = makePlan({
      steps: [makeStep('step_0'), makeStep('step_1', 'verify_all_scenes')],
      approvalGates: [gate],
    });
    const ctx = makeContext(controller.signal);

    let gateReached = false;
    const result = await runPipeline(plan, makeRegistry(successExecutor, verifyExecutor), ctx, {
      onGateReached: async (_gate) => {
        gateReached = true;
        return 'approved';
      },
    });

    expect(gateReached).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.steps[1].status).toBe('completed');
  });

  it('marks plan as cancelled when gate is rejected', async () => {
    const gate = makeGate('gate-1', 'step_0');
    const plan = makePlan({
      steps: [makeStep('step_0'), makeStep('step_1', 'verify_all_scenes')],
      approvalGates: [gate],
    });
    const ctx = makeContext(controller.signal);

    const result = await runPipeline(plan, makeRegistry(successExecutor, verifyExecutor), ctx, {
      onGateReached: async () => 'rejected',
    });

    expect(result.status).toBe('cancelled');
    // step_1 should be skipped because plan was cancelled
    expect(result.steps[1].status).toBe('skipped');
  });

  it('stores step output and makes it accessible', async () => {
    const plan = makePlan({ steps: [makeStep('step_0')] });
    const ctx = makeContext(controller.signal, (id) => {
      // resolveStepOutput is provided by the runner — we test below via the real function
      void id;
      return undefined;
    });

    const result = await runPipeline(plan, makeRegistry(successExecutor), ctx);
    // Output should be stored on the step
    const capturedOutput = result.steps[0].output;
    expect(capturedOutput).toEqual({ created: true });
  });

  it('resolveStepOutput accepts step ID (e.g. step_0)', async () => {
    let resolvedById: Record<string, unknown> | undefined;

    const probeRegistry = new Map<ExecutorName, ExecutorDefinition>([
      ['scene_create', {
        name: 'scene_create',
        inputSchema: z.object({}),
        execute: async (_input, _ctx): Promise<ExecutorResult> => ({ success: true, output: { created: true } }),
        userFacingErrorMessage: '',
      }],
      ['verify_all_scenes', {
        name: 'verify_all_scenes',
        inputSchema: z.object({}),
        execute: async (_input, ctx): Promise<ExecutorResult> => {
          resolvedById = ctx.resolveStepOutput('step_0');
          return { success: true, output: {} };
        },
        userFacingErrorMessage: '',
      }],
    ]);

    const plan = makePlan({
      steps: [makeStep('step_0', 'scene_create'), makeStep('step_1', 'verify_all_scenes')],
    });
    const ctx = makeContext(controller.signal);
    await runPipeline(plan, probeRegistry, ctx);
    expect(resolvedById).toEqual({ created: true });
  });

  it('resolveStepOutput falls back to executor name lookup', async () => {
    let resolvedByName: Record<string, unknown> | undefined;

    const probeRegistry = new Map<ExecutorName, ExecutorDefinition>([
      ['scene_create', {
        name: 'scene_create',
        inputSchema: z.object({}),
        execute: async (): Promise<ExecutorResult> => ({ success: true, output: { byName: true } }),
        userFacingErrorMessage: '',
      }],
      ['verify_all_scenes', {
        name: 'verify_all_scenes',
        inputSchema: z.object({}),
        execute: async (_input, ctx): Promise<ExecutorResult> => {
          resolvedByName = ctx.resolveStepOutput('scene_create');
          return { success: true, output: {} };
        },
        userFacingErrorMessage: '',
      }],
    ]);

    const plan = makePlan({
      steps: [makeStep('step_0', 'scene_create'), makeStep('step_1', 'verify_all_scenes')],
    });
    const ctx = makeContext(controller.signal);
    await runPipeline(plan, probeRegistry, ctx);
    expect(resolvedByName).toEqual({ byName: true });
  });

  it('resolveStepOutputs returns EVERY matching step, in plan order (PF-1213)', async () => {
    // `resolveStepOutput` answers with the first match, which silently dropped
    // the second `physics_enable` step a plan now carries (blueprint cast, then
    // world geometry). The geometry the player lands on was never tuned.
    let resolvedAll: Record<string, unknown>[] | undefined;
    let call = 0;

    const probeRegistry = new Map<ExecutorName, ExecutorDefinition>([
      ['physics_enable', {
        name: 'physics_enable',
        inputSchema: z.object({}),
        execute: async (): Promise<ExecutorResult> => {
          call += 1;
          return { success: true, output: { entityIds: [`id-${call}`] } };
        },
        userFacingErrorMessage: '',
      }],
      ['physics_profile', {
        name: 'physics_profile',
        inputSchema: z.object({}),
        execute: async (_input, ctx): Promise<ExecutorResult> => {
          resolvedAll = ctx.resolveStepOutputs('physics_enable');
          return { success: true, output: {} };
        },
        userFacingErrorMessage: '',
      }],
    ]);

    const plan = makePlan({
      steps: [
        makeStep('step_0', 'physics_enable'),
        makeStep('step_1', 'physics_enable'),
        makeStep('step_2', 'physics_profile'),
      ],
    });
    await runPipeline(plan, probeRegistry, makeContext(controller.signal));

    expect(resolvedAll).toEqual([{ entityIds: ['id-1'] }, { entityIds: ['id-2'] }]);
  });

  it('resolveStepOutputs omits steps that have not produced an output yet', async () => {
    // A step further down the plan has no `output` until it runs. Including an
    // `undefined` there would put a hole in the caller's fold.
    let resolvedAll: Record<string, unknown>[] | undefined;

    const probeRegistry = new Map<ExecutorName, ExecutorDefinition>([
      ['physics_enable', {
        name: 'physics_enable',
        inputSchema: z.object({}),
        execute: async (): Promise<ExecutorResult> => ({ success: true, output: { entityIds: ['id-1'] } }),
        userFacingErrorMessage: '',
      }],
      ['physics_profile', {
        name: 'physics_profile',
        inputSchema: z.object({}),
        execute: async (_input, ctx): Promise<ExecutorResult> => {
          resolvedAll = ctx.resolveStepOutputs('physics_enable');
          return { success: true, output: {} };
        },
        userFacingErrorMessage: '',
      }],
    ]);

    const plan = makePlan({
      steps: [
        makeStep('step_0', 'physics_enable'),
        makeStep('step_1', 'physics_profile'),
        makeStep('step_2', 'physics_enable'),
      ],
    });
    await runPipeline(plan, probeRegistry, makeContext(controller.signal));

    expect(resolvedAll).toEqual([{ entityIds: ['id-1'] }]);
  });

  it('resolveStepOutputs walks an empty step slot instead of skipping past it', async () => {
    // `.filter`/`.map` skip an array HOLE outright, so a rewrite to a callback
    // form would report the list fully processed while a step vanished — and
    // one JSON round trip turns that hole into a `null`, which the same
    // callback form dereferences and throws on. Both slot shapes are fed here.
    //
    // The runner's own loop is walked over them too: it indexes `plan.steps`
    // directly, so an unguarded slot would crash inside `dependenciesMet`
    // before the resolver was ever consulted.
    let resolvedAll: Record<string, unknown>[] | undefined;
    let call = 0;

    const probeRegistry = new Map<ExecutorName, ExecutorDefinition>([
      ['physics_enable', {
        name: 'physics_enable',
        inputSchema: z.object({}),
        execute: async (): Promise<ExecutorResult> => {
          call += 1;
          return { success: true, output: { entityIds: [`id-${call}`] } };
        },
        userFacingErrorMessage: '',
      }],
      ['physics_profile', {
        name: 'physics_profile',
        inputSchema: z.object({}),
        execute: async (_input, ctx): Promise<ExecutorResult> => {
          resolvedAll = ctx.resolveStepOutputs('physics_enable');
          return { success: true, output: {} };
        },
        userFacingErrorMessage: '',
      }],
    ]);

    // The gap between the two commas is the input under test, not a typo, and
    // the `null` beside it is what that gap becomes after a save/load cycle.
    const steps = [
      makeStep('step_0', 'physics_enable'),
      ,
      null as unknown as OrchestratorPlan['steps'][number],
      makeStep('step_3', 'physics_enable'),
      makeStep('step_4', 'physics_profile'),
    ] as OrchestratorPlan['steps'];
    expect(steps).toHaveLength(5);

    const plan = makePlan({ steps });
    await runPipeline(plan, probeRegistry, makeContext(controller.signal));

    // `Array.from` materializes any hole as an explicit `undefined`, so this
    // cannot pass on a sparse result the way `toHaveLength` would.
    expect(Array.from(resolvedAll ?? [])).toEqual([
      { entityIds: ['id-1'] },
      { entityIds: ['id-2'] },
    ]);
    expect(plan.status).toBe('completed');
  });

  it('resolveStepOutputs omits a failed step that kept diagnostic output', async () => {
    // `retainDiagnosticOutput` keeps the output of a step that returned
    // `success: false`, so "has an output" is not "worked". An optional step is
    // the case that matters: it is skipped and the plan runs ON, so a caller
    // folding these together would silently take a half-finished step's ids for
    // finished work.
    let resolvedAll: Record<string, unknown>[] | undefined;

    const probeRegistry = new Map<ExecutorName, ExecutorDefinition>([
      ['physics_enable', {
        name: 'physics_enable',
        inputSchema: z.object({}),
        execute: async (): Promise<ExecutorResult> => ({
          success: false,
          output: { entityIds: ['half-done'] },
          error: {
            code: 'COMMAND_FAILED',
            message: 'Engine rejected a toggle_physics command',
            userFacingMessage: 'Could not switch physics on.',
            retryable: false,
          },
        }),
        userFacingErrorMessage: '',
      }],
      ['physics_profile', {
        name: 'physics_profile',
        inputSchema: z.object({}),
        execute: async (_input, ctx): Promise<ExecutorResult> => {
          resolvedAll = ctx.resolveStepOutputs('physics_enable');
          return { success: true, output: {} };
        },
        userFacingErrorMessage: '',
      }],
    ]);

    const plan = makePlan({
      steps: [
        makeStep('step_0', 'physics_enable', { optional: true }),
        makeStep('step_1', 'physics_profile'),
      ],
    });
    await runPipeline(plan, probeRegistry, makeContext(controller.signal));

    // The output IS on the step — this is not a test that the runner dropped it.
    expect(plan.steps[0].status).toBe('skipped');
    expect(plan.steps[0].output).toEqual({ entityIds: ['half-done'] });
    expect(resolvedAll).toEqual([]);
  });

  it('resolveStepOutputs returns an empty list when no step matches', async () => {
    let resolvedAll: Record<string, unknown>[] | undefined;

    const probeRegistry = new Map<ExecutorName, ExecutorDefinition>([
      ['physics_profile', {
        name: 'physics_profile',
        inputSchema: z.object({}),
        execute: async (_input, ctx): Promise<ExecutorResult> => {
          resolvedAll = ctx.resolveStepOutputs('physics_enable');
          return { success: true, output: {} };
        },
        userFacingErrorMessage: '',
      }],
    ]);

    const plan = makePlan({ steps: [makeStep('step_0', 'physics_profile')] });
    await runPipeline(plan, probeRegistry, makeContext(controller.signal));

    expect(resolvedAll).toEqual([]);
  });

  it('resolveStepOutput walks an empty step slot instead of throwing on it', async () => {
    // The SINGULAR resolver, which `auto_polish` calls on every real run.
    // `.find` does NOT skip a hole — it visits it with `undefined` — and a
    // `null` slot behaves the same way, so an unguarded lookup throws inside
    // whichever executor happened to ask, blaming that step for a gap
    // somewhere else in the plan.
    let resolved: Record<string, unknown> | undefined;
    let call = 0;

    const probeRegistry = new Map<ExecutorName, ExecutorDefinition>([
      ['physics_enable', {
        name: 'physics_enable',
        inputSchema: z.object({}),
        execute: async (): Promise<ExecutorResult> => {
          call += 1;
          return { success: true, output: { entityIds: [`id-${call}`] } };
        },
        userFacingErrorMessage: '',
      }],
      ['physics_profile', {
        name: 'physics_profile',
        inputSchema: z.object({}),
        execute: async (_input, ctx): Promise<ExecutorResult> => {
          resolved = ctx.resolveStepOutput('physics_enable');
          return { success: true, output: {} };
        },
        userFacingErrorMessage: '',
      }],
    ]);

    // The gap between the two commas is the input under test, not a typo.
    const steps = [
      makeStep('step_0', 'physics_enable'),
      ,
      null as unknown as OrchestratorPlan['steps'][number],
      makeStep('step_3', 'physics_profile'),
    ] as OrchestratorPlan['steps'];

    const plan = makePlan({ steps });
    await runPipeline(plan, probeRegistry, makeContext(controller.signal));

    // A throw inside the executor is caught by the runner and reported as a
    // step failure, so the status assertion is what catches an unguarded
    // lookup — the resolved value alone would not.
    expect(plan.steps[3].status).toBe('completed');
    expect(resolved).toEqual({ entityIds: ['id-1'] });
  });

  it('resolveStepOutput omits a failed step that kept diagnostic output', async () => {
    // Same rule as the plural resolver: `retainDiagnosticOutput` keeps a failed
    // step's output, so "has an output" is not "worked". An optional step is
    // the case that matters — the plan runs ON past it.
    let resolved: Record<string, unknown> | undefined;

    const probeRegistry = new Map<ExecutorName, ExecutorDefinition>([
      ['physics_enable', {
        name: 'physics_enable',
        inputSchema: z.object({}),
        execute: async (): Promise<ExecutorResult> => ({
          success: false,
          error: { code: 'ERR', message: 'half done', userFacingMessage: 'Half done', retryable: false },
          output: { entityIds: ['half-done'] },
        }),
        userFacingErrorMessage: '',
      }],
      ['physics_profile', {
        name: 'physics_profile',
        inputSchema: z.object({}),
        execute: async (_input, ctx): Promise<ExecutorResult> => {
          resolved = ctx.resolveStepOutput('physics_enable');
          return { success: true, output: {} };
        },
        userFacingErrorMessage: '',
      }],
    ]);

    const plan = makePlan({
      steps: [
        makeStep('step_0', 'physics_enable', { optional: true }),
        makeStep('step_1', 'physics_profile'),
      ],
    });
    await runPipeline(plan, probeRegistry, makeContext(controller.signal));

    // The output IS on the step — this is not a test that the runner dropped it.
    expect(plan.steps[0].status).toBe('skipped');
    expect(plan.steps[0].output).toEqual({ entityIds: ['half-done'] });
    expect(resolved).toBeUndefined();
  });

  it('skips the steps after a failure across an empty slot', async () => {
    // The "skip everything after the failure" loop walks raw indices, so it is
    // the one place an empty slot is guaranteed to be touched — and it runs on
    // the FAILURE path, where an unguarded write turns a handled step failure
    // into an unhandled TypeError out of `runPipeline` itself.
    const steps = [
      makeStep('step_0', 'physics_profile'),
      ,
      null as unknown as OrchestratorPlan['steps'][number],
      makeStep('step_3', 'scene_create'),
    ] as OrchestratorPlan['steps'];

    const plan = makePlan({ steps });
    const result = await runPipeline(
      plan,
      makeRegistry(failureExecutor, successExecutor),
      makeContext(controller.signal),
    );

    expect(result.status).toBe('failed');
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[3].status).toBe('skipped');
  });

  it('skips the steps after a cancel across an empty slot', async () => {
    // Same index walk on the cancel path. The empty slots sit after the first
    // step the abort check reaches, which is what puts them inside the skip
    // loop rather than the `continue` above it.
    const localController = new AbortController();

    const abortingExecutor: ExecutorDefinition = {
      name: 'scene_create',
      inputSchema: z.object({}),
      execute: async (): Promise<ExecutorResult> => {
        localController.abort();
        return { success: true, output: {} };
      },
      userFacingErrorMessage: '',
    };

    const steps = [
      makeStep('step_0', 'scene_create'),
      makeStep('step_1', 'verify_all_scenes'),
      ,
      null as unknown as OrchestratorPlan['steps'][number],
      makeStep('step_4', 'verify_all_scenes'),
    ] as OrchestratorPlan['steps'];

    const plan = makePlan({ steps });
    const result = await runPipeline(
      plan,
      makeRegistry(abortingExecutor, verifyExecutor),
      makeContext(localController.signal),
    );

    expect(result.status).toBe('cancelled');
    expect(result.steps[1].status).toBe('skipped');
    expect(result.steps[4].status).toBe('skipped');
  });

  it('records an empty step slot on the plan instead of quietly finishing without it', async () => {
    // Tolerating a gap is only half an answer: a plan that runs every step it
    // HAS and reports `completed` leaves nothing to say a step it called for
    // never ran. The notice is user-facing language, not the zero-based
    // "slot" indices a player has no way to act on — those go to
    // `console.warn` instead (asserted separately below).
    const steps = [
      makeStep('step_0', 'scene_create'),
      ,
      null as unknown as OrchestratorPlan['steps'][number],
    ] as OrchestratorPlan['steps'];

    const plan = makePlan({ steps });
    const result = await runPipeline(plan, makeRegistry(successExecutor), makeContext(controller.signal));

    expect(result.status).toBe('completed');
    expect(result.warnings).toEqual([
      'Some of the planned steps were missing from the plan and were not run — regenerate the plan to fill them in.',
    ]);

    const single = makePlan({
      steps: [
        makeStep('step_0', 'scene_create'),
        null as unknown as OrchestratorPlan['steps'][number],
      ] as OrchestratorPlan['steps'],
    });
    const singleResult = await runPipeline(
      single,
      makeRegistry(successExecutor),
      makeContext(controller.signal),
    );
    expect(singleResult.warnings).toEqual([
      'One of the planned steps was missing from the plan and was not run — regenerate the plan to fill it in.',
    ]);
  });

  it('logs the empty-slot indices to the console rather than the user-facing warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const steps = [
        makeStep('step_0', 'scene_create'),
        ,
        null as unknown as OrchestratorPlan['steps'][number],
      ] as OrchestratorPlan['steps'];
      const plan = makePlan({ steps });

      await runPipeline(plan, makeRegistry(successExecutor), makeContext(controller.signal));

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [devMessage] = warnSpy.mock.calls[0] as [string];
      expect(devMessage).toContain('1, 2');
      expect(devMessage).not.toContain('regenerate the plan');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not duplicate the empty-slot warning when the same plan is run twice', async () => {
    // `recordEmptyStepSlots` owns only its own two exact notices (`planBuilder`
    // writes to the same array). Re-running the same plan object (a retry, a
    // re-run after a fix that did not touch `plan.steps`) must not grow the
    // array — the panel would otherwise show the identical notice once per run.
    const steps = [
      makeStep('step_0', 'scene_create'),
      ,
      null as unknown as OrchestratorPlan['steps'][number],
    ] as OrchestratorPlan['steps'];
    const plan = makePlan({ steps });

    await runPipeline(plan, makeRegistry(successExecutor), makeContext(controller.signal));
    const secondResult = await runPipeline(plan, makeRegistry(successExecutor), makeContext(controller.signal));

    expect(secondResult.warnings).toEqual([
      'Some of the planned steps were missing from the plan and were not run — regenerate the plan to fill them in.',
    ]);
  });

  it('clears its own empty-slot warning once every slot is filled, without disturbing others', async () => {
    // Filtering by exact message match (not a blanket array replace) is what
    // keeps this safe alongside the OTHER producer of `plan.warnings` that
    // already exists: `planBuilder` writes its planning warnings onto the same
    // array before the run starts.
    const holedSteps = [
      makeStep('step_0', 'scene_create'),
      null as unknown as OrchestratorPlan['steps'][number],
    ] as OrchestratorPlan['steps'];
    const plan = makePlan({ steps: holedSteps, warnings: ['unrelated warning from elsewhere'] });

    await runPipeline(plan, makeRegistry(successExecutor), makeContext(controller.signal));
    expect(plan.warnings).toEqual([
      'unrelated warning from elsewhere',
      'One of the planned steps was missing from the plan and was not run — regenerate the plan to fill it in.',
    ]);

    plan.steps = [makeStep('step_0', 'scene_create'), makeStep('step_1', 'scene_create')];
    await runPipeline(plan, makeRegistry(successExecutor), makeContext(controller.signal));
    expect(plan.warnings).toEqual(['unrelated warning from elsewhere']);
  });

  it('leaves warnings alone on a plan with no empty slot', async () => {
    const plan = makePlan({ steps: [makeStep('step_0', 'scene_create')] });
    const result = await runPipeline(plan, makeRegistry(successExecutor), makeContext(controller.signal));

    expect(result.status).toBe('completed');
    expect(result.warnings).toBeUndefined();
  });

  it('respects abort signal: completes current step then skips remaining', async () => {
    const localController = new AbortController();
    let step1Started = false;

    const slowRegistry = new Map<ExecutorName, ExecutorDefinition>([
      ['scene_create', {
        name: 'scene_create',
        inputSchema: z.object({}),
        execute: async (): Promise<ExecutorResult> => {
          // Abort during step_0 execution
          localController.abort();
          return { success: true, output: { aborted: true } };
        },
        userFacingErrorMessage: '',
      }],
      ['verify_all_scenes', {
        name: 'verify_all_scenes',
        inputSchema: z.object({}),
        execute: async (): Promise<ExecutorResult> => {
          step1Started = true;
          return { success: true, output: {} };
        },
        userFacingErrorMessage: '',
      }],
    ]);

    const plan = makePlan({
      steps: [makeStep('step_0', 'scene_create'), makeStep('step_1', 'verify_all_scenes')],
    });
    const ctx = makeContext(localController.signal);
    const result = await runPipeline(plan, slowRegistry, ctx);

    expect(result.steps[0].status).toBe('completed'); // current step finishes
    expect(step1Started).toBe(false); // next step skipped
    expect(result.steps[1].status).toBe('skipped');
    expect(result.status).toBe('cancelled'); // plan status transitions to cancelled on abort
  });

  it('respects abort signal mid-retry: does not start another attempt', async () => {
    const localController = new AbortController();
    let attempts = 0;
    let step1Started = false;

    const retryRegistry = new Map<ExecutorName, ExecutorDefinition>([
      ['scene_create', {
        name: 'scene_create',
        inputSchema: z.object({}),
        execute: async (): Promise<ExecutorResult> => {
          attempts += 1;
          // Cancel arrives while the first attempt is in flight.
          localController.abort();
          return {
            success: false,
            error: {
              code: 'TRANSIENT',
              message: 'provider hiccup',
              userFacingMessage: 'Scene creation failed.',
              retryable: true,
            },
          };
        },
        userFacingErrorMessage: 'Scene creation failed.',
      }],
      ['verify_all_scenes', {
        name: 'verify_all_scenes',
        inputSchema: z.object({}),
        execute: async (): Promise<ExecutorResult> => {
          step1Started = true;
          return { success: true, output: {} };
        },
        userFacingErrorMessage: '',
      }],
    ]);

    const plan = makePlan({
      steps: [
        makeStep('step_0', 'scene_create', { maxRetries: 3 }),
        makeStep('step_1', 'verify_all_scenes'),
      ],
    });
    const ctx = makeContext(localController.signal);
    const result = await runPipeline(plan, retryRegistry, ctx);

    expect(attempts).toBe(1); // the three remaining retries are abandoned
    expect(step1Started).toBe(false);
    expect(result.steps[0].status).toBe('skipped');
    expect(result.steps[1].status).toBe('skipped');
    expect(result.status).toBe('cancelled'); // cancelled, not failed
  });

  it('still reports failed (not cancelled) when retries are genuinely exhausted', async () => {
    const plan = makePlan({ steps: [makeStep('step_0', 'scene_create', { maxRetries: 1 })] });
    const ctx = makeContext(controller.signal);
    let attempts = 0;

    const result = await runPipeline(plan, makeRegistry({
      name: 'scene_create',
      inputSchema: z.object({}),
      execute: async (): Promise<ExecutorResult> => {
        attempts += 1;
        return {
          success: false,
          error: {
            code: 'TRANSIENT',
            message: 'provider hiccup',
            userFacingMessage: 'Scene creation failed.',
            retryable: true,
          },
        };
      },
      userFacingErrorMessage: 'Scene creation failed.',
    }), ctx);

    expect(attempts).toBe(2);
    expect(result.steps[0].status).toBe('failed');
    expect(result.status).toBe('failed');
  });

  it('fires onPlanStatusChange when plan status transitions', async () => {
    const statuses: string[] = [];
    const plan = makePlan({ steps: [makeStep('step_0')] });
    const ctx = makeContext(controller.signal);

    await runPipeline(plan, makeRegistry(successExecutor), ctx, {
      onPlanStatusChange: (status) => { statuses.push(status); },
    });

    expect(statuses).toContain('completed');
  });

  it('plan status is executing while steps run', async () => {
    let statusDuringExecution: string | undefined;

    const trackingRegistry = new Map<ExecutorName, ExecutorDefinition>([
      ['scene_create', {
        name: 'scene_create',
        inputSchema: z.object({}),
        execute: async (_input, _ctx): Promise<ExecutorResult> => {
          statusDuringExecution = plan.status;
          return { success: true, output: {} };
        },
        userFacingErrorMessage: '',
      }],
    ]);

    const plan = makePlan({ steps: [makeStep('step_0')] });
    const ctx = makeContext(controller.signal);
    await runPipeline(plan, trackingRegistry, ctx);
    expect(statusDuringExecution).toBe('executing');
  });

  // A failing executor is not necessarily a silent one — `verify_all_scenes`
  // reports why the game cannot be won and THEN fails, so that the plan fails
  // rather than handing over an unwinnable game. The diagnostic used to be
  // dropped here: `step.output` was assigned on the success path only, so the
  // plan carried an empty step and everything the executor had to say was lost
  // to `resolveStepOutput` and to anything re-rendering a finished run.
  describe('diagnostic output on a failing step', () => {
    const diagnosticFailure: ExecutorDefinition = {
      name: 'verify_all_scenes',
      inputSchema: z.object({}),
      execute: async (): Promise<ExecutorResult> => ({
        success: false,
        error: { code: 'NOT_WINNABLE', message: 'no win condition', userFacingMessage: 'Cannot be won', retryable: false },
        output: { winnable: false, warnings: ['no win condition'] },
      }),
      userFacingErrorMessage: 'Verify failed',
    };

    it('keeps the output of a failed non-optional step', async () => {
      const plan = makePlan({ steps: [makeStep('step_0', 'verify_all_scenes')] });
      const ctx = makeContext(controller.signal);

      const result = await runPipeline(plan, makeRegistry(diagnosticFailure), ctx);

      expect(result.steps[0].status).toBe('failed');
      expect(result.steps[0].output).toEqual({ winnable: false, warnings: ['no win condition'] });
      expect(result.steps[0].error?.code).toBe('NOT_WINNABLE');
    });

    it('keeps the output of a failed optional step', async () => {
      const plan = makePlan({
        steps: [makeStep('step_0', 'verify_all_scenes', { optional: true })],
      });
      const ctx = makeContext(controller.signal);

      const result = await runPipeline(plan, makeRegistry(diagnosticFailure), ctx);

      expect(result.steps[0].status).toBe('skipped');
      expect(result.steps[0].output).toEqual({ winnable: false, warnings: ['no win condition'] });
    });

    // An empty failure must stay undefined rather than become `{}` — a
    // dependent reading `{}` would take it for "ran, produced nothing".
    it('leaves output undefined when the failure carried none', async () => {
      const plan = makePlan({ steps: [makeStep('step_0', 'physics_profile')] });
      const ctx = makeContext(controller.signal);

      const result = await runPipeline(plan, makeRegistry(failureExecutor), ctx);

      expect(result.steps[0].status).toBe('failed');
      expect(result.steps[0].output).toBeUndefined();
    });
  });

  it('gate without onGateReached callback defaults to approved', async () => {
    const gate = makeGate('gate-1', 'step_0');
    const plan = makePlan({
      steps: [makeStep('step_0'), makeStep('step_1', 'verify_all_scenes')],
      approvalGates: [gate],
    });
    const ctx = makeContext(controller.signal);

    // No onGateReached callback — should auto-approve
    const result = await runPipeline(plan, makeRegistry(successExecutor, verifyExecutor), ctx);
    expect(result.status).toBe('completed');
    expect(result.steps[1].status).toBe('completed');
  });
});
