import type { ThemeTokens } from '../tokens';

const CURRENT_SCHEMA_VERSION = 1;
const HEX_REGEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const LENGTH_REGEX = /^\d+(\.\d+)?(px|rem)$/;
// Require minimum 50ms to prevent disabling transitions (0ms) and sub-perceptible flash effects.
// Range is 50–2000ms. 2-digit value must start with 5-9 (50–99ms), or be 3-4 digits (100–9999ms,
// capped by MAX_DURATION_MS check below).
const DURATION_REGEX = /^([5-9]\d|\d{3,4})ms$/;
const MAX_DURATION_MS = 2000;
const MAX_LENGTH_PX = 64;
const MAX_LENGTH_REM = 4;

// FONT_ALLOWLIST contains both full CSS font stacks AND their bare family names.
// The bare entries ('Geist Sans', 'Geist Mono') exist because some tooling may pass
// just the primary family name without the full fallback stack. Both forms are safe.
const FONT_ALLOWLIST = [
  'inherit',
  "'Geist Sans', system-ui, sans-serif",
  "'Geist Mono', ui-monospace, monospace",
  // Bare family names — same typefaces as above, without fallback stacks
  'Geist Sans',
  'Geist Mono',
  // Generic stacks without a named family — safe CSS-only values
  'system-ui, sans-serif',
  'ui-monospace, monospace',
];

const COLOR_TOKEN_KEYS = new Set<string>([
  '--sf-bg-app', '--sf-bg-surface', '--sf-bg-elevated', '--sf-bg-overlay',
  '--sf-text', '--sf-text-secondary', '--sf-text-muted', '--sf-text-disabled',
  '--sf-border', '--sf-border-strong',
  '--sf-accent', '--sf-accent-hover', '--sf-destructive', '--sf-success', '--sf-warning',
]);

const LENGTH_TOKEN_KEYS = new Set<string>([
  '--sf-radius-sm', '--sf-radius-md', '--sf-radius-lg', '--sf-radius-xl', '--sf-radius-full',
  '--sf-border-width',
]);

const FONT_TOKEN_KEYS = new Set<string>(['--sf-font-ui', '--sf-font-mono']);
const DURATION_TOKEN_KEYS = new Set<string>(['--sf-transition']);

const ALL_VALID_KEYS = new Set([
  ...COLOR_TOKEN_KEYS,
  ...LENGTH_TOKEN_KEYS,
  ...FONT_TOKEN_KEYS,
  ...DURATION_TOKEN_KEYS,
]);

// Branded type prevents raw parsed JSON from being passed to applyThemeTokens()
// or saveCustomTheme() without going through validateCustomTheme() first.
// The unique symbol makes it impossible to construct ValidatedTheme without calling this module.
const _validated = Symbol('validated');

export interface ValidatedTheme {
  /** @internal Branding field — do NOT read or set. Created only by validateCustomTheme(). */
  readonly [_validated]: true;
  schemaVersion: number;
  name: string;
  author: string;
  description: string;
  tokens: Partial<ThemeTokens>;
}

type ValidationResult =
  | { ok: true; theme: ValidatedTheme }
  | { ok: false; error: string };

export function validateCustomTheme(
  input: unknown,
  options?: { byteSize?: number },
): ValidationResult {
  if (options?.byteSize !== undefined && options.byteSize > 50_000) {
    return { ok: false, error: 'Theme file exceeds 50KB limit.' };
  }

  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Input must be a JSON object.' };
  }

  const obj = input as Record<string, unknown>;

  // schemaVersion
  if (
    !('schemaVersion' in obj) ||
    typeof obj.schemaVersion !== 'number' ||
    !Number.isInteger(obj.schemaVersion) ||
    obj.schemaVersion < 1
  ) {
    return { ok: false, error: 'Missing or invalid schemaVersion. Must be a positive integer.' };
  }
  if (obj.schemaVersion > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `This theme requires SpawnForge v${obj.schemaVersion}. Your version supports v${CURRENT_SCHEMA_VERSION}.`,
    };
  }

  // Metadata
  const name = typeof obj.name === 'string' ? obj.name : '';
  const author = typeof obj.author === 'string' ? obj.author : '';
  const description = typeof obj.description === 'string' ? obj.description : '';

  if (name.length > 64) return { ok: false, error: 'Theme name must be 64 characters or fewer.' };
  if (author.length > 64) return { ok: false, error: 'Author must be 64 characters or fewer.' };
  if (description.length > 256) return { ok: false, error: 'Description must be 256 characters or fewer.' };

  // Tokens
  const rawTokens =
    typeof obj.tokens === 'object' && obj.tokens !== null
      ? (obj.tokens as Record<string, unknown>)
      : {};
  const validatedTokens: Record<string, string> = {};

  for (const [key, value] of Object.entries(rawTokens)) {
    if (!ALL_VALID_KEYS.has(key)) continue; // Drop unknown keys silently

    if (typeof value !== 'string') {
      return { ok: false, error: `Token ${key}: value must be a string.` };
    }

    if (COLOR_TOKEN_KEYS.has(key)) {
      if (!HEX_REGEX.test(value)) {
        return {
          ok: false,
          error: `Token ${key}: must be hex color like #ff00ff. Got: "${value}"`,
        };
      }
    } else if (LENGTH_TOKEN_KEYS.has(key)) {
      if (!LENGTH_REGEX.test(value)) {
        return {
          ok: false,
          error: `Token ${key}: must be a length like 6px or 1rem. Got: "${value}"`,
        };
      }
      const num = parseFloat(value);
      if (value.endsWith('px') && num > MAX_LENGTH_PX) {
        return { ok: false, error: `Token ${key}: max ${MAX_LENGTH_PX}px. Got: "${value}"` };
      }
      if (value.endsWith('rem') && num > MAX_LENGTH_REM) {
        return { ok: false, error: `Token ${key}: max ${MAX_LENGTH_REM}rem. Got: "${value}"` };
      }
    } else if (FONT_TOKEN_KEYS.has(key)) {
      if (!FONT_ALLOWLIST.includes(value)) {
        return {
          ok: false,
          error: `Token ${key}: must be one of the allowed font stacks. Got: "${value}"`,
        };
      }
    } else if (DURATION_TOKEN_KEYS.has(key)) {
      if (!DURATION_REGEX.test(value)) {
        return {
          ok: false,
          error: `Token ${key}: must be in milliseconds like 150ms (min 50ms). Got: "${value}"`,
        };
      }
      const ms = parseInt(value, 10);
      if (ms > MAX_DURATION_MS) {
        return { ok: false, error: `Token ${key}: max ${MAX_DURATION_MS}ms. Got: "${value}"` };
      }
    }

    validatedTokens[key] = value;
  }

  return {
    ok: true,
    // Type cast is the ONLY place ValidatedTheme is constructed — this is intentional.
    // The branded [_validated] field cannot be set otherwise, enforcing the validator is called.
    theme: {
      [_validated]: true as const,
      schemaVersion: obj.schemaVersion as number,
      name,
      author,
      description,
      tokens: validatedTokens as Partial<ThemeTokens>,
    } as ValidatedTheme,
  };
}
