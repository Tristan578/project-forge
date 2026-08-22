/**
 * Pipeline Runner — generic step executor for the Game Creation Orchestrator.
 *
 * Executes OrchestratorPlan steps in array order, respecting dependsOn chains,
 * handling retries, abort signals, and approval gates. Mutates the plan in
 * place and returns it.
 *
 * Zero external imports beyond types.
 */

import type {
  OrchestratorPlan,
  PlanStep,
  ExecutorDefinition,
  ExecutorContext,
  ExecutorName,
  ExecutorResult,
  ApprovalGate,
} from './types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PipelineCallbacks {
  onStepComplete?: (stepId: string, result: ExecutorResult) => void;
  onGateReached?: (gate: ApprovalGate) => Promise<'approved' | 'rejected'>;
  onPlanStatusChange?: (status: OrchestratorPlan['status']) => void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function setPlanStatus(plan: OrchestratorPlan, status: OrchestratorPlan['status'], callbacks?: PipelineCallbacks): void {
  plan.status = status;
  callbacks?.onPlanStatusChange?.(status);
}

function setStepStatus(step: PlanStep, status: PlanStep['status']): void {
  step.status = status;
}

/**
 * Check whether all steps listed in dependsOn have completed successfully.
 * Uses a precomputed Map for O(1) lookups instead of O(n) find() per dep.
 */
function dependenciesMet(step: PlanStep, stepMap: Map<string, PlanStep>): boolean {
  for (const depId of step.dependsOn) {
    const dep = stepMap.get(depId);
    if (!dep || dep.status !== 'completed') {
      return false;
    }
  }
  return true;
}

/**
 * Keep a failed step's diagnostic output on the step.
 *
 * A failing executor is not necessarily silent: `verify_all_scenes` reports
 * WHY the game cannot be won on its output (`warnings`, `winnable`,
 * `winnabilityIssues`) and then returns `success: false`, because an unwinnable
 * game must fail the plan rather than be handed over. `step.output` used to be
 * assigned on the success path only, so everything the step had to say was
 * dropped the moment it said it — the live `onStepComplete` callback saw the
 * result, but the plan itself carried an empty step, and the plan is what
 * `resolveStepOutput` reads and what the orchestrator store keeps to re-render
 * a finished run.
 *
 * Only assigned when the executor really produced output: a genuinely empty
 * failure must stay `undefined` rather than become `{}`, which a dependent
 * would read as "ran, produced nothing".
 */
function retainDiagnosticOutput(step: PlanStep, result: ExecutorResult | undefined): void {
  if (result?.output !== undefined) {
    step.output = result.output;
  }
}

/**
 * Find gates that fire after the given step ID.
 */
function gatesAfterStep(stepId: string, gates: ApprovalGate[]): ApprovalGate[] {
  return gates.filter((g) => g.afterStepId === stepId && g.status === 'pending');
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run a pipeline plan to completion, handling retries, gates, and abort signals.
 *
 * @param plan             - The orchestrator plan (mutated in place).
 * @param executorRegistry - Map of executor name -> ExecutorDefinition.
 * @param context          - Executor context (dispatchCommand, store, signal, etc.).
 * @param callbacks        - Optional lifecycle callbacks.
 * @returns                The mutated plan.
 */
export async function runPipeline(
  plan: OrchestratorPlan,
  executorRegistry: Map<ExecutorName, ExecutorDefinition>,
  context: ExecutorContext,
  callbacks?: PipelineCallbacks,
): Promise<OrchestratorPlan> {
  // Build a resolveStepOutput function that closes over the plan's steps.
  // The caller's context.resolveStepOutput is replaced with this live version.
  const liveResolve = (stepIdOrExecutorName: string): Record<string, unknown> | undefined => {
    // 1. Try exact step ID match first (e.g. 'step_0')
    const byId = plan.steps.find((s) => s.id === stepIdOrExecutorName);
    if (byId) {
      return byId.output;
    }
    // 2. Fall back to matching by executor name (e.g. 'scene_create')
    const byName = plan.steps.find((s) => s.executor === stepIdOrExecutorName);
    return byName?.output;
  };

  // Every output for an executor name, not just the first.
  //
  // `liveResolve` above answers with the first match, which is wrong the moment
  // a plan runs the same executor twice — and this one does: `physics_enable`
  // is planned once for the blueprint cast and again for the world geometry.
  // A caller reading the singular resolver's `entityIds` silently gets half the
  // scene (see `ExecutorContext.resolveStepOutputs`).
  //
  // Indexed loop: `.filter`/`.map` skip an array hole outright, and a dropped
  // step here is invisible — the ids just never arrive.
  const liveResolveAll = (executorName: string): Record<string, unknown>[] => {
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < plan.steps.length; i += 1) {
      const step = plan.steps[i];
      if (step?.executor !== executorName) continue;
      if (step.output) out.push(step.output);
    }
    return out;
  };

  // Compose the effective context with the live resolvers
  const effectiveContext: ExecutorContext = {
    ...context,
    resolveStepOutput: liveResolve,
    resolveStepOutputs: liveResolveAll,
  };

  // Mark plan as executing
  setPlanStatus(plan, 'executing', callbacks);

  if (plan.steps.length === 0) {
    setPlanStatus(plan, 'completed', callbacks);
    return plan;
  }

  // Precompute step lookup map for O(1) dependency checks
  const stepMap = new Map<string, PlanStep>();
  for (const s of plan.steps) {
    stepMap.set(s.id, s);
  }

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    plan.currentStepIndex = i;

    // Check abort signal before starting each new step
    if (context.signal.aborted) {
      // Mark all remaining steps as skipped and set plan to cancelled
      for (let j = i; j < plan.steps.length; j++) {
        setStepStatus(plan.steps[j], 'skipped');
      }
      setPlanStatus(plan, 'cancelled', callbacks);
      return plan;
    }

    // Skip step if any dependency was not completed.
    // If the step is non-optional, this is a pipeline failure — a required
    // step cannot run because its upstream dependency failed/was skipped.
    if (!dependenciesMet(step, stepMap)) {
      setStepStatus(step, 'skipped');
      if (!step.optional) {
        step.error = {
          code: 'DEPENDENCY_FAILED',
          message: `Required step "${step.id}" skipped because a dependency was not completed`,
          userFacingMessage: 'A required step could not run because a previous step failed.',
          retryable: false,
        };
        setPlanStatus(plan, 'failed', callbacks);
        for (let j = i + 1; j < plan.steps.length; j++) {
          setStepStatus(plan.steps[j], 'skipped');
        }
        return plan;
      }
      continue;
    }

    // Get the executor
    const executor = executorRegistry.get(step.executor);
    if (!executor) {
      // Unknown executor — treat as failed
      setStepStatus(step, 'failed');
      step.error = {
        code: 'UNKNOWN_EXECUTOR',
        message: `No executor registered for "${step.executor}"`,
        userFacingMessage: `Unknown step type: ${step.executor}`,
        retryable: false,
      };
      if (!step.optional) {
        setPlanStatus(plan, 'failed', callbacks);
        // Skip remaining steps
        for (let j = i + 1; j < plan.steps.length; j++) {
          setStepStatus(plan.steps[j], 'skipped');
        }
        return plan;
      }
      continue;
    }

    // Execute with retries
    setStepStatus(step, 'running');

    let lastResult: ExecutorResult | undefined;
    let cancelledMidRetry = false;
    const maxAttempts = step.maxRetries + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // A cancel that lands while an attempt is in flight must not buy the
      // step another one. Each retry of a generation step is a fresh
      // multi-second provider call, so checking only between steps means the
      // user's cancel is honoured no sooner than the last retry's completion.
      if (attempt > 0 && context.signal.aborted) {
        cancelledMidRetry = true;
        break;
      }

      try {
        lastResult = await executor.execute(step.input, effectiveContext);
      } catch (err) {
        lastResult = {
          success: false,
          error: {
            code: 'EXCEPTION',
            message: err instanceof Error ? err.message : String(err),
            userFacingMessage: executor.userFacingErrorMessage,
            retryable: true,
          },
        };
      }

      if (lastResult.success) {
        break;
      }
      // Don't retry non-recoverable errors (e.g. invalid input)
      if (lastResult.error && !lastResult.error.retryable) {
        break;
      }
    }

    // Retries were cut short by a cancel, so the step did not fail on its own
    // merits — report the plan as cancelled rather than failed. A step that
    // genuinely exhausted its retries (or failed non-retryably) still reports
    // failed below, even if a cancel happened to land alongside it.
    if (cancelledMidRetry) {
      setStepStatus(step, 'skipped');
      step.error = lastResult?.error;
      retainDiagnosticOutput(step, lastResult);
      for (let j = i + 1; j < plan.steps.length; j++) {
        setStepStatus(plan.steps[j], 'skipped');
      }
      setPlanStatus(plan, 'cancelled', callbacks);
      return plan;
    }

    if (lastResult?.success) {
      setStepStatus(step, 'completed');
      step.output = lastResult.output ?? {};
      callbacks?.onStepComplete?.(step.id, lastResult);
    } else {
      // All attempts failed
      if (step.optional) {
        setStepStatus(step, 'skipped');
        step.error = lastResult?.error;
        retainDiagnosticOutput(step, lastResult);
        callbacks?.onStepComplete?.(step.id, lastResult ?? { success: false });
      } else {
        setStepStatus(step, 'failed');
        step.error = lastResult?.error;
        retainDiagnosticOutput(step, lastResult);
        callbacks?.onStepComplete?.(step.id, lastResult ?? { success: false });
        setPlanStatus(plan, 'failed', callbacks);
        // Skip remaining steps
        for (let j = i + 1; j < plan.steps.length; j++) {
          setStepStatus(plan.steps[j], 'skipped');
        }
        return plan;
      }
    }

    // Check approval gates after each completed step
    if (step.status === 'completed') {
      const gates = gatesAfterStep(step.id, plan.approvalGates);
      for (const gate of gates) {
        let decision: 'approved' | 'rejected' = 'approved';
        if (callbacks?.onGateReached) {
          decision = await callbacks.onGateReached(gate);
        }
        gate.status = decision;

        if (decision === 'rejected') {
          setPlanStatus(plan, 'cancelled', callbacks);
          // Skip all remaining steps
          for (let j = i + 1; j < plan.steps.length; j++) {
            setStepStatus(plan.steps[j], 'skipped');
          }
          return plan;
        }
      }
    }
  }

  // If we reach here without failure or cancellation, plan is complete
  if (plan.status !== 'failed' && plan.status !== 'cancelled') {
    setPlanStatus(plan, 'completed', callbacks);
  }

  return plan;
}
