/**
 * Lightweight argument parser for command handlers.
 *
 * Uses the validator functions from `validators.ts` and schema definitions from
 * `types.ts` to validate a `Record<string, unknown>` args bag.  Returns either
 * the parsed & typed data or an `ExecutionResult` error suitable for returning
 * directly from a handler.
 *
 * This is intentionally NOT Zod — it uses the project's own validation
 * primitives and returns handler-compatible error shapes.
 */

import type { ExecutionResult } from '@/lib/chat/handlers/types';
import type { ArgsSchema, InferParsed, ValidationFailure } from './types';

/** The return type of `parseHandlerArgs`. */
export type ParseResult<S extends ArgsSchema> =
  | { data: InferParsed<S>; error?: undefined }
  | { data?: undefined; error: ExecutionResult };

/**
 * Parse and validate handler arguments against a schema.
 *
 * Example usage:
 * ```ts
 * const p = parseHandlerArgs(args, {
 *   entityId: { validate: entityId() },
 *   name:     { validate: boundedString(1, 128), optional: true },
 * });
 * if (p.error) return p.error;
 * // p.data.entityId is string, p.data.name is string | undefined
 * ```
 */
export function parseHandlerArgs<S extends ArgsSchema>(
  args: Record<string, unknown>,
  schema: S,
): ParseResult<S> {
  const errors: ValidationFailure[] = [];
  const parsed: Record<string, unknown> = {};

  for (const [key, fieldSchema] of Object.entries(schema)) {
    const value = args[key];

    // Handle missing/undefined values
    if (value === undefined || value === null) {
      if (fieldSchema.optional) {
        // Leave the field undefined in the output
        continue;
      }
      errors.push({ valid: false, error: `${key} is required`, field: key });
      continue;
    }

    // Run the validator
    const result = fieldSchema.validate(value, key);
    if (!result.valid) {
      errors.push(result);
    } else {
      parsed[key] = result.value;
    }
  }

  if (errors.length > 0) {
    const messages = errors.map((e) => `${e.field}: ${e.error}`).join('; ');
    return {
      error: { success: false, error: `Invalid arguments: ${messages}` },
    };
  }

  return { data: parsed as InferParsed<S> };
}
