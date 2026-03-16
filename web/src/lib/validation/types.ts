/**
 * Core validation types for the shared validation framework.
 *
 * These types provide a consistent, Zod-independent result type that can be
 * used by individual validators and composed by parseArgs.  The framework
 * complements (not replaces) the existing Zod-based parseArgs in
 * `chat/handlers/types.ts` by offering lightweight, reusable validation
 * primitives that can be applied both inside and outside Zod schemas.
 */

/** Successful validation, carrying the cleaned value. */
export interface ValidationSuccess<T> {
  valid: true;
  value: T;
}

/** Failed validation, carrying a human-readable error and the offending field name. */
export interface ValidationFailure {
  valid: false;
  error: string;
  field: string;
}

/** Discriminated union returned by every validator function. */
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/**
 * A validator is a pure function from an unknown input to a ValidationResult.
 * The `field` string is threaded through so error messages include context.
 */
export type ValidatorFn<T> = (value: unknown, field: string) => ValidationResult<T>;

/**
 * Schema definition used by `parseArgs`.  Maps field names to their validator
 * function plus an `optional` flag.  When `optional` is true the field may be
 * absent or undefined — the validator is only called when a value is present.
 */
export interface FieldSchema<T = unknown> {
  validate: ValidatorFn<T>;
  optional?: boolean;
}

/** A record of field names to their schema definitions. */
export type ArgsSchema = Record<string, FieldSchema>;

/**
 * Infer the parsed output type from an ArgsSchema.
 *
 * Required fields produce `T`, optional fields produce `T | undefined`.
 */
export type InferParsed<S extends ArgsSchema> = {
  [K in keyof S as S[K]['optional'] extends true ? never : K]: S[K] extends FieldSchema<infer T> ? T : never;
} & {
  [K in keyof S as S[K]['optional'] extends true ? K : never]?: S[K] extends FieldSchema<infer T> ? T : never;
};
