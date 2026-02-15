/**
 * Input sanitization for AI chat and command arguments.
 * Prevents prompt injection, script injection, and malformed data.
 */

/**
 * Sanitize user chat input to prevent prompt injection.
 *
 * @param input - Raw user message
 * @returns Sanitized string (max 4000 chars, stripped of control characters)
 */
export function sanitizeChatInput(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  // Remove control characters (except tab, newline, carriage return)
  let sanitized = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Limit length
  sanitized = sanitized.slice(0, 4000);

  // Trim whitespace
  sanitized = sanitized.trim();

  return sanitized;
}

/**
 * Validate and sanitize entity name.
 * Allows alphanumeric, spaces, hyphens, underscores. Max 64 chars.
 *
 * @param name - Raw entity name
 * @returns Sanitized name
 */
export function validateEntityName(name: string): string {
  if (typeof name !== 'string') {
    return 'Entity';
  }

  // Remove non-whitelisted characters
  let sanitized = name.replace(/[^a-zA-Z0-9\s\-_]/g, '');

  // Collapse multiple spaces
  sanitized = sanitized.replace(/\s+/g, ' ');

  // Limit length
  sanitized = sanitized.slice(0, 64);

  // Trim whitespace
  sanitized = sanitized.trim();

  return sanitized || 'Entity';
}

/**
 * Validate numeric value is within expected range.
 *
 * @param value - Number to validate
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @param defaultValue - Default if out of range
 * @returns Clamped value
 */
function clampNumber(
  value: number,
  min: number,
  max: number,
  defaultValue: number
): number {
  if (typeof value !== 'number' || !isFinite(value)) {
    return defaultValue;
  }
  return Math.max(min, Math.min(max, value));
}

/**
 * Sanitize a string value in command arguments.
 *
 * @param value - Raw string
 * @param maxLength - Max allowed length
 * @returns Sanitized string
 */
function sanitizeString(value: string, maxLength = 1000): string {
  if (typeof value !== 'string') {
    return '';
  }

  // Remove control characters
  let sanitized = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Limit length
  sanitized = sanitized.slice(0, maxLength);

  return sanitized;
}

/**
 * Validate command arguments recursively.
 * Sanitizes strings, clamps numbers, removes unexpected keys.
 *
 * @param args - Raw command arguments
 * @param maxDepth - Max recursion depth (prevents stack overflow)
 * @returns Validated arguments
 */
export function validateCommandArgs(
  args: Record<string, unknown>,
  maxDepth = 5
): Record<string, unknown> {
  if (maxDepth <= 0) {
    return {};
  }

  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return {};
  }

  const validated: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    // Sanitize key (alphanumeric + underscore only)
    const sanitizedKey = key.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 64);
    if (!sanitizedKey) {
      continue; // Skip invalid keys
    }

    if (typeof value === 'string') {
      validated[sanitizedKey] = sanitizeString(value);
    } else if (typeof value === 'number') {
      // Reasonable bounds for game engine values
      validated[sanitizedKey] = clampNumber(value, -1e6, 1e6, 0);
    } else if (typeof value === 'boolean') {
      validated[sanitizedKey] = value;
    } else if (Array.isArray(value)) {
      // Validate array elements
      validated[sanitizedKey] = value
        .slice(0, 100) // Max 100 elements
        .map((item) => {
          if (typeof item === 'string') {
            return sanitizeString(item, 200);
          } else if (typeof item === 'number') {
            return clampNumber(item, -1e6, 1e6, 0);
          } else if (typeof item === 'boolean') {
            return item;
          }
          return null;
        })
        .filter((item) => item !== null);
    } else if (typeof value === 'object' && value !== null) {
      // Recurse into nested objects
      validated[sanitizedKey] = validateCommandArgs(
        value as Record<string, unknown>,
        maxDepth - 1
      );
    }
    // Ignore functions, symbols, undefined
  }

  return validated;
}

/**
 * Validate request body size.
 *
 * @param body - Request body string
 * @param maxBytes - Maximum allowed size in bytes
 * @returns True if valid, false if oversized
 */
export function validateBodySize(body: string, maxBytes: number): boolean {
  if (typeof body !== 'string') {
    return false;
  }

  // UTF-8 byte count approximation (more accurate than .length)
  const byteCount = new Blob([body]).size;
  return byteCount <= maxBytes;
}

/**
 * Detect common prompt injection patterns.
 * Returns true if suspicious patterns are found.
 *
 * @param input - User input to check
 * @returns True if injection detected
 */
export function detectPromptInjection(input: string): boolean {
  if (typeof input !== 'string') {
    return false;
  }

  const lowerInput = input.toLowerCase();

  // Common injection patterns
  const injectionPatterns = [
    /ignore\s+(all\s+)?(previous|above|system|prior)\s+(instructions?|prompts?|rules?|commands?)/i,
    /ignore\s+above/i,
    /forget\s+(everything|all|instructions?|context)/i,
    /new\s+(instruction|rule|prompt|system|role):/i,
    /you\s+are\s+now\s+/i,
    /system\s*:\s*/i,
    /\[system\]/i,
    /<\|im_start\|>/i,
    /<\|im_end\|>/i,
    /\{\{.*system.*\}\}/i,
  ];

  for (const pattern of injectionPatterns) {
    if (pattern.test(lowerInput)) {
      return true;
    }
  }

  return false;
}
