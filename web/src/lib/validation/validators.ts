/**
 * Reusable validator functions for command handler arguments.
 *
 * Each validator returns a `ValidationResult<T>` — either `{ valid: true, value }` or
 * `{ valid: false, error, field }`.  They are designed to be composed via `parseArgs`
 * or used standalone in any handler, API route, or utility.
 */

import type { ValidationResult, ValidatorFn } from './types';

// ===== Primitive validators =====

/**
 * Validate that a value is a non-empty string representing an entity ID.
 * Rejects empty strings and strings longer than 256 characters (arbitrary
 * but reasonable upper bound for UUIDs / Bevy entity IDs).
 */
export function validateEntityId(value: unknown, field: string = 'entityId'): ValidationResult<string> {
  if (typeof value !== 'string') {
    return { valid: false, error: `${field} must be a string`, field };
  }
  if (value.length === 0) {
    return { valid: false, error: `${field} must not be empty`, field };
  }
  if (value.length > 256) {
    return { valid: false, error: `${field} exceeds maximum length of 256`, field };
  }
  return { valid: true, value };
}

/**
 * Validate that a value is a string within the given length bounds (inclusive).
 */
export function validateBoundedString(
  value: unknown,
  min: number,
  max: number,
  field: string = 'string'
): ValidationResult<string> {
  if (typeof value !== 'string') {
    return { valid: false, error: `${field} must be a string`, field };
  }
  if (value.length < min) {
    return { valid: false, error: `${field} must be at least ${min} characters`, field };
  }
  if (value.length > max) {
    return { valid: false, error: `${field} must be at most ${max} characters`, field };
  }
  return { valid: true, value };
}

/**
 * Validate that a value is a finite number greater than zero.
 */
export function validatePositiveNumber(value: unknown, field: string = 'number'): ValidationResult<number> {
  if (typeof value !== 'number') {
    return { valid: false, error: `${field} must be a number`, field };
  }
  if (!Number.isFinite(value)) {
    return { valid: false, error: `${field} must be finite`, field };
  }
  if (value <= 0) {
    return { valid: false, error: `${field} must be greater than 0`, field };
  }
  return { valid: true, value };
}

/**
 * Validate that a value is a finite number (including zero and negatives).
 */
export function validateFiniteNumber(value: unknown, field: string = 'number'): ValidationResult<number> {
  if (typeof value !== 'number') {
    return { valid: false, error: `${field} must be a number`, field };
  }
  if (!Number.isFinite(value)) {
    return { valid: false, error: `${field} must be finite`, field };
  }
  return { valid: true, value };
}

/**
 * Validate that a value is one of the allowed enum strings.
 */
export function validateEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string = 'value'
): ValidationResult<T> {
  if (typeof value !== 'string') {
    return { valid: false, error: `${field} must be a string`, field };
  }
  if (!(allowed as readonly string[]).includes(value)) {
    return { valid: false, error: `${field} must be one of: ${allowed.join(', ')}`, field };
  }
  return { valid: true, value: value as T };
}

/**
 * Validate that a value is present (not null / undefined).
 * Does NOT validate the type — compose with other validators for that.
 */
export function validateRequired(value: unknown, field: string = 'value'): ValidationResult<unknown> {
  if (value === null || value === undefined) {
    return { valid: false, error: `${field} is required`, field };
  }
  return { valid: true, value };
}

/**
 * Validate that a value is a boolean.
 */
export function validateBoolean(value: unknown, field: string = 'value'): ValidationResult<boolean> {
  if (typeof value !== 'boolean') {
    return { valid: false, error: `${field} must be a boolean`, field };
  }
  return { valid: true, value };
}

/**
 * Validate that a value is a finite number within an inclusive range.
 */
export function validateNumberInRange(
  value: unknown,
  min: number,
  max: number,
  field: string = 'number'
): ValidationResult<number> {
  if (typeof value !== 'number') {
    return { valid: false, error: `${field} must be a number`, field };
  }
  if (!Number.isFinite(value)) {
    return { valid: false, error: `${field} must be finite`, field };
  }
  if (value < min || value > max) {
    return { valid: false, error: `${field} must be between ${min} and ${max}`, field };
  }
  return { valid: true, value };
}

/**
 * Validate that a value is an array where every element passes a validator.
 */
export function validateArray<T>(
  value: unknown,
  elementValidator: ValidatorFn<T>,
  field: string = 'array'
): ValidationResult<T[]> {
  if (!Array.isArray(value)) {
    return { valid: false, error: `${field} must be an array`, field };
  }
  const results: T[] = [];
  for (let i = 0; i < value.length; i++) {
    const r = elementValidator(value[i], `${field}[${i}]`);
    if (!r.valid) return r as ValidationResult<T[]>;
    results.push(r.value);
  }
  return { valid: true, value: results };
}

// ===== Factory helpers =====

/** Create a ValidatorFn for entity IDs. */
export function entityId(): ValidatorFn<string> {
  return (value, field) => validateEntityId(value, field);
}

/** Create a ValidatorFn for bounded strings. */
export function boundedString(min: number, max: number): ValidatorFn<string> {
  return (value, field) => validateBoundedString(value, min, max, field);
}

/** Create a ValidatorFn for positive numbers. */
export function positiveNumber(): ValidatorFn<number> {
  return (value, field) => validatePositiveNumber(value, field);
}

/** Create a ValidatorFn for finite numbers. */
export function finiteNumber(): ValidatorFn<number> {
  return (value, field) => validateFiniteNumber(value, field);
}

/** Create a ValidatorFn for enum values. */
export function enumValue<T extends string>(allowed: readonly T[]): ValidatorFn<T> {
  return (value, field) => validateEnum(value, allowed, field);
}

/** Create a ValidatorFn for required values. */
export function required(): ValidatorFn<unknown> {
  return (value, field) => validateRequired(value, field);
}

/** Create a ValidatorFn for booleans. */
export function boolean(): ValidatorFn<boolean> {
  return (value, field) => validateBoolean(value, field);
}

/** Create a ValidatorFn for numbers in a range. */
export function numberInRange(min: number, max: number): ValidatorFn<number> {
  return (value, field) => validateNumberInRange(value, min, max, field);
}

/** Create a ValidatorFn for arrays with element validation. */
export function array<T>(elementValidator: ValidatorFn<T>): ValidatorFn<T[]> {
  return (value, field) => validateArray(value, elementValidator, field);
}
