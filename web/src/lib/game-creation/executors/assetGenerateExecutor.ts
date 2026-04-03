import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { FALLBACK_SCHEMA } from '../types';
import { makeStepError, successResult, failResult } from './shared';

const inputSchema = z.object({
  type: z.enum(['3d-model', 'texture', 'sound', 'music', 'voice', 'sprite']),
  description: z.string().min(1).max(500),
  entityRef: z.string().optional(),
  styleDirective: z.string().max(500),
  priority: z.enum(['required', 'nice-to-have']),
  fallback: z.string(),
  maxRetries: z.number().int().min(0).max(5).optional(),
  optional: z.boolean().optional(),
});

/**
 * Mock generation call. In production this would call /api/generate with
 * the appropriate endpoint for the asset type. Returns a stable placeholder
 * asset ID for unit testing.
 */
async function generateAsset(
  _type: string,
  _description: string,
  _styleDirective: string,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) {
    throw new Error('Aborted');
  }
  // Production: would call fetch('/api/generate/...', { signal })
  // Placeholder — returns a unique-ish ID for each call. Tests should assert
  // on success/failure, not the specific ID value.
  return `asset_${crypto.randomUUID().slice(0, 8)}`;
}

export const assetGenerateExecutor: ExecutorDefinition = {
  name: 'asset_generate',
  inputSchema,
  userFacingErrorMessage:
    'Asset generation failed. Using a placeholder instead.',

  async execute(
    input: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<ExecutorResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return failResult(
        makeStepError(
          'INVALID_INPUT',
          parsed.error.message,
          this.userFacingErrorMessage,
        ),
      );
    }

    const { type, description, styleDirective, fallback } = parsed.data;

    // Validate fallback before attempting generation, so we can use it on failure
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
      return successResult({
        assetId: fallbackParsed.data,
        usedFallback: true,
      });
    }

    let assetId: string;
    let usedFallback = false;

    try {
      assetId = await generateAsset(type, description, styleDirective, ctx.signal);
    } catch {
      // Generation failed — use validated fallback
      assetId = fallbackParsed.data;
      usedFallback = true;
    }

    return successResult({ assetId, usedFallback });
  },
};

