import type { OrchestratorStepError, ExecutorResult } from '../types';

export function makeStepError(
  code: string,
  message: string,
  userFacingMessage: string,
  retryable = false,
  details?: unknown,
): OrchestratorStepError {
  return { code, message, userFacingMessage, retryable, details };
}

export function failResult(error: OrchestratorStepError): ExecutorResult {
  return { success: false, error };
}

export function successResult(output: Record<string, unknown> = {}): ExecutorResult {
  return { success: true, output };
}
