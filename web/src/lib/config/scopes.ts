/**
 * API key scope definitions and validation.
 *
 * Single source of truth for all MCP/API key scope strings.
 * Used by:
 *   - DB schema default (`web/src/lib/db/schema.ts`)
 *   - API key creation route (`web/src/app/api/keys/api-key/route.ts`)
 *   - Any future scope-checking middleware
 */

// ---------------------------------------------------------------------------
// Scope definitions
// ---------------------------------------------------------------------------

/**
 * Valid scope domains (the part before the colon).
 */
export const SCOPE_DOMAINS = ['scene', 'ai', 'project'] as const;
export type ScopeDomain = (typeof SCOPE_DOMAINS)[number];

/**
 * Valid scope verbs per domain.
 */
export const SCOPE_VERBS: Record<ScopeDomain, readonly string[]> = {
  scene: ['read', 'write'],
  ai: ['generate'],
  project: ['manage'],
};

/**
 * All valid API key scopes. This is the canonical list.
 */
export const API_KEY_SCOPES = [
  'scene:read',
  'scene:write',
  'ai:generate',
  'project:manage',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/**
 * Default scopes assigned to new API keys.
 * Currently all scopes — restrict as needed.
 */
export const DEFAULT_API_KEY_SCOPES: readonly ApiKeyScope[] = API_KEY_SCOPES;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Regex pattern for a valid scope string: `domain:verb` */
export const SCOPE_PATTERN = /^[a-z]+:[a-z_]+$/;

/** Set for O(1) lookup */
const VALID_SCOPE_SET = new Set<string>(API_KEY_SCOPES);

/**
 * Check whether a string is a valid API key scope.
 *
 * @param s - The string to validate
 * @returns True if `s` is a recognized scope
 */
export function isValidScope(s: string): s is ApiKeyScope {
  return VALID_SCOPE_SET.has(s);
}

/**
 * Build a scope string from domain and verb parts.
 * Returns the scope if valid, throws if the combination is not recognized.
 *
 * @example
 * ```ts
 * const s = scope('ai', 'generate'); // 'ai:generate'
 * ```
 */
export function scope(domain: ScopeDomain, verb: string): ApiKeyScope {
  const candidate = `${domain}:${verb}`;
  if (!isValidScope(candidate)) {
    throw new Error(
      `Invalid scope "${candidate}". Valid scopes: ${API_KEY_SCOPES.join(', ')}`
    );
  }
  return candidate;
}

/**
 * Validate an array of scope strings. Returns the invalid entries.
 *
 * @param scopes - Array of strings to check
 * @returns Array of strings that are NOT valid scopes (empty if all valid)
 */
export function findInvalidScopes(scopes: readonly string[]): string[] {
  return scopes.filter((s) => !isValidScope(s));
}
