import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assetGenerateExecutor } from '../executors/assetGenerateExecutor';
import { runPipeline } from '../pipelineRunner';
import { collectStepWarnings } from '../stepWarnings';
import type { ExecutorContext, ExecutorDefinition, ExecutorName, OrchestratorPlan } from '../types';

const assetTypes = ['3d-model', 'texture', 'sound', 'music', 'voice', 'sprite'] as const;

function makePlan(type: typeof assetTypes[number], optional: boolean): OrchestratorPlan {
  return {
    id: 'asset-plan',
    projectId: 'project-1',
    prompt: 'Add an asset to my game',
    gdd: {
      id: 'asset-gdd',
      title: 'Asset fixture',
      description: 'An asset-generation plan used to exercise the real executor boundary.',
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
      projectType: '3d',
    },
    steps: [{
      id: 'generate_asset',
      executor: 'asset_generate',
      input: {
        type,
        description: 'An asset for the player',
        styleDirective: 'retro',
        priority: optional ? 'nice-to-have' : 'required',
        fallback: 'builtin:default-asset',
        entityRef: 'player',
      },
      dependsOn: [],
      maxRetries: 5,
      optional,
      status: 'pending',
    }],
    approvalGates: [{
      id: 'review_asset',
      label: 'Review generated asset',
      description: 'Review the completed asset.',
      afterStepId: 'generate_asset',
      status: 'pending',
      displayData: {},
    }],
    tokenEstimate: {
      breakdown: [],
      totalEstimated: 0,
      totalVarianceHigh: 0,
      totalVarianceLow: 0,
      userTier: 'creator',
      sufficientBalance: true,
    },
    status: 'executing',
    currentStepIndex: 0,
    createdAt: 0,
  };
}

function makeContext(): ExecutorContext {
  return {
    dispatchCommand: vi.fn(),
    getStore: vi.fn(() => { throw new Error('Unavailable generation must not access the editor store'); }),
    projectType: '3d',
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn(),
    resolveStepOutputs: vi.fn(() => []),
  };
}

describe('unavailable asset generation through the real pipeline', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockRejectedValue(new Error('Unexpected paid generation request'));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe.each([false, true])('optional=%s', (optional) => {
    it.each(assetTypes)('does not retry, request paid generation, attach or report a successful %s step on repeated runs', async (type) => {
      const execute = vi.spyOn(assetGenerateExecutor, 'execute');
      const registry = new Map<ExecutorName, ExecutorDefinition>([['asset_generate', assetGenerateExecutor]]);
      const plan = makePlan(type, optional);
      const ctx = makeContext();
      const onStepComplete = vi.fn();
      const onGateReached = vi.fn().mockResolvedValue('approved');
      const onPlanStatusChange = vi.fn();

      for (let run = 1; run <= 2; run++) {
        await runPipeline(plan, registry, ctx, { onStepComplete, onGateReached, onPlanStatusChange });

        expect(execute).toHaveBeenCalledTimes(run);
        expect(plan.status).toBe(optional ? 'completed' : 'failed');
        expect(plan.steps[0].status).toBe(optional ? 'skipped' : 'failed');
        expect(plan.steps[0].error).toMatchObject({
          code: 'ASSET_GENERATION_UNAVAILABLE',
          retryable: false,
        });
        expect(plan.steps[0].output).toEqual({
          unsupported: true,
          pending: true,
          assetType: type,
          fallbackAssetId: 'builtin:default-asset',
        });
        expect(collectStepWarnings(plan.steps[0].output)).toEqual([]);
        expect(onStepComplete).toHaveBeenCalledTimes(run);
        expect(onStepComplete).toHaveBeenLastCalledWith('generate_asset', expect.objectContaining({
          success: false,
          error: expect.objectContaining({ code: 'ASSET_GENERATION_UNAVAILABLE', retryable: false }),
        }));
        expect(onGateReached).not.toHaveBeenCalled();
        expect(plan.approvalGates[0].status).toBe('pending');
        expect(ctx.dispatchCommand).not.toHaveBeenCalled();
        expect(ctx.getStore).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();

        if (optional) {
          // The store combines output notices and plan warnings; one missing
          // asset must produce one attention item.
          expect([...collectStepWarnings(plan.steps[0].output), ...(plan.warnings ?? [])]).toHaveLength(1);
          expect(plan.warnings).toHaveLength(1);
          expect(plan.warnings?.[0]).toContain(assetGenerateExecutor.userFacingErrorMessage);
        } else {
          expect(onPlanStatusChange).not.toHaveBeenCalledWith('completed');
        }
      }
    });
  });
});
