import { z } from 'zod';
import type { ExecutorDefinition, ExecutorResult } from '../types';
import { successResult } from './shared';

const inputSchema = z.object({
  sceneCount: z.number(),
  systemCount: z.number(),
  entityCount: z.number(),
}).passthrough();

/**
 * No-op executor that passes through plan summary data.
 * Exists so gate_plan can anchor on step_0 and fire BEFORE any
 * engine commands are dispatched (scene creation, entity spawning, etc.).
 */
export const planPresentExecutor: ExecutorDefinition = {
  name: 'plan_present',
  inputSchema,
  userFacingErrorMessage: 'Could not prepare plan summary.',

  async execute(input: Record<string, unknown>): Promise<ExecutorResult> {
    const parsed = inputSchema.safeParse(input);
    return successResult(parsed.success ? parsed.data : input);
  },
};
