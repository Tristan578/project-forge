import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { FALLBACK_SCHEMA } from '../types';
import { makeStepError, failResult } from './shared';

// Keep planned SFX durations compatible with the existing standalone route.
const SFX_MIN_SECONDS = 0.5;
const SFX_MAX_SECONDS = 22;

const inputSchema = z.object({
  type: z.enum(['3d-model', 'texture', 'sound', 'music', 'voice', 'sprite']),
  description: z.string().min(1).max(500),
  entityRef: z.string().optional(),
  styleDirective: z.string().max(500),
  priority: z.enum(['required', 'nice-to-have']),
  fallback: z.string(),
  maxRetries: z.number().int().min(0).max(5).optional(),
  optional: z.boolean().optional(),
  // This validates the plan; generation remains unavailable below.
  durationSeconds: z.number().min(SFX_MIN_SECONDS).max(SFX_MAX_SECONDS).optional(),
});

/**
 * Asset generation remains unavailable until the pipeline can deliver a
 * persisted artifact and settle generation within its existing reservation.
 * Calling a standalone paid route here would deduct separately while the
 * pipeline has no consumer for the returned audio (#10035, #9922, #9808).
 */
export const assetGenerateExecutor: ExecutorDefinition = {
  name: 'asset_generate',
  inputSchema,
  userFacingErrorMessage:
    'Asset generation is not available in game creation yet. Add an existing asset or remove this step.',

  async execute(
    input: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<ExecutorResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return failResult(
        makeStepError('INVALID_INPUT', parsed.error.message, this.userFacingErrorMessage),
      );
    }

    const { type, fallback } = parsed.data;
    const fallbackParsed = FALLBACK_SCHEMA.safeParse(fallback);
    if (!fallbackParsed.success) {
      return failResult(
        makeStepError(
          'INVALID_FALLBACK',
          `Fallback value is invalid: ${fallbackParsed.error.message}`,
          this.userFacingErrorMessage,
        ),
      );
    }

    if (ctx.signal.aborted) {
      return failResult(
        makeStepError('CANCELLED', 'Asset generation was cancelled.', 'Asset generation was cancelled.'),
      );
    }

    // A fallback identifier is only a suggestion: nothing was generated or
    // attached. Failure stops required steps and skips optional ones without
    // counting this step as completed in reservation settlement.
    return {
      ...failResult(
        makeStepError(
          'ASSET_GENERATION_UNAVAILABLE',
          `The ${type} adapter requires artifact delivery and reservation-aware billing.`,
          this.userFacingErrorMessage,
        ),
      ),
      output: {
        unsupported: true,
        pending: true,
        assetType: type,
        fallbackAssetId: fallbackParsed.data,
        warning: this.userFacingErrorMessage,
      },
    };
  },
};
