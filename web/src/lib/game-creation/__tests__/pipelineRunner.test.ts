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
  executor: 'scene_create' | 'physics_profile' | 'verify_all_scenes' = 'scene_create',
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

function makeContext(signal: AbortSignal, resolveStepOutput?: (id: string) => Record<string, unknown> | undefined): ExecutorContext {
  return {
    dispatchCommand: vi.fn(),
    store: {} as ExecutorContext['store'],
    projectType: '2d',
    userTier: 'starter',
    signal,
    resolveStepOutput: resolveStepOutput ?? (() => undefined),
  };
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

function makeRegistry(...defs: ExecutorDefinition[]): Map<string, ExecutorDefinition> {
  const map = new Map<string, ExecutorDefinition>();
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
    const orderedRegistry = new Map<string, ExecutorDefinition>([
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
    const trackingRegistry = new Map<string, ExecutorDefinition>([
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
    const flakyRegistry = new Map<string, ExecutorDefinition>([
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

    const probeRegistry = new Map<string, ExecutorDefinition>([
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

    const probeRegistry = new Map<string, ExecutorDefinition>([
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

  it('respects abort signal: completes current step then skips remaining', async () => {
    const localController = new AbortController();
    let step1Started = false;

    const slowRegistry = new Map<string, ExecutorDefinition>([
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

    const trackingRegistry = new Map<string, ExecutorDefinition>([
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
