/**
 * Shared validation framework for command handlers.
 *
 * Re-exports types, validators, and the parseHandlerArgs utility.
 */

export type {
  ValidationResult,
  ValidationSuccess,
  ValidationFailure,
  ValidatorFn,
  FieldSchema,
  ArgsSchema,
  InferParsed,
} from './types';

export {
  // Direct validators (call with value + field)
  validateEntityId,
  validateBoundedString,
  validatePositiveNumber,
  validateFiniteNumber,
  validateEnum,
  validateRequired,
  validateBoolean,
  validateNumberInRange,
  validateArray,
  // Factory helpers (return ValidatorFn for use in schemas)
  entityId,
  boundedString,
  positiveNumber,
  finiteNumber,
  enumValue,
  required,
  boolean,
  array,
  numberInRange,
} from './validators';

export { parseHandlerArgs } from './parseArgs';
export type { ParseResult } from './parseArgs';

// Keep existing exports
export { validateResourceId } from './resourceId';
