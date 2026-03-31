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
 * Returns false if any dependency is failed or skipped (i.e. did not complete).
 */
function dependenciesMet(step: PlanStep, steps: PlanStep[]): boolean {
  for (const depId of step.dependsOn) {
    const dep = steps.find((s) => s.id === depId);
    if (!dep || dep.status !== 'completed') {
      return false;
    }
  }
  return true;
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

  // Compose the effective context with the live resolver
  const effectiveContext: ExecutorContext = {
    ...context,
    resolveStepOutput: liveResolve,
  };

  // Mark plan as executing
  setPlanStatus(plan, 'executing', callbacks);

  if (plan.steps.length === 0) {
    setPlanStatus(plan, 'completed', callbacks);
    return plan;
  }

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    plan.currentStepIndex = i;

    // Check abort signal before starting each new step
    if (context.signal.aborted) {
      setStepStatus(step, 'skipped');
      continue;
    }

    // Skip step if any dependency was not completed
    if (!dependenciesMet(step, plan.steps)) {
      setStepStatus(step, 'skipped');
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
    const maxAttempts = step.maxRetries + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
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
        callbacks?.onStepComplete?.(step.id, lastResult ?? { success: false });
      } else {
        setStepStatus(step, 'failed');
        step.error = lastResult?.error;
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
