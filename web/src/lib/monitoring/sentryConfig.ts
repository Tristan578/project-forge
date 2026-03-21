import * as Sentry from '@sentry/nextjs';

/**
 * Known AI provider names used in error fingerprinting.
 * Must match the provider identifiers used by the generation routes.
 */
const AI_PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'meshy',
  'elevenlabs',
  'suno',
  'replicate',
  'stability',
] as const;

/**
 * Known generation types for asset-generation error grouping.
 */
const GENERATION_TYPES = [
  'sprite',
  'model',
  'sfx',
  'music',
  'voice',
  'texture',
  'skybox',
] as const;

/**
 * Extract AI provider name from an error message or value.
 * Returns the matched provider slug, or null if none found.
 */
function extractProvider(text: string): string | null {
  const lower = text.toLowerCase();
  for (const p of AI_PROVIDERS) {
    if (lower.includes(p)) return p;
  }
  return null;
}

/**
 * Extract generation type from an error message or value.
 * Returns the matched type slug, or null if none found.
 */
function extractGenerationType(text: string): string | null {
  const lower = text.toLowerCase();
  for (const t of GENERATION_TYPES) {
    if (lower.includes(t)) return t;
  }
  return null;
}

/**
 * Derive a compact fingerprint token from a WASM command string.
 * E.g. "spawn_entity" -> "spawn_entity", "update_material abc-123" -> "update_material"
 */
function extractCommandType(message: string): string {
  const match = /(?:command|cmd)[:\s]+([a-z_]+)/i.exec(message);
  if (match?.[1]) return match[1].toLowerCase();
  // Fall back to first snake_case word in the message
  const wordMatch = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/.exec(message);
  return wordMatch?.[1] ?? 'unknown_command';
}

/**
 * Derive a compact auth error code from an error message or value.
 */
function extractAuthCode(text: string): string {
  const statusMatch = /\b(4\d{2}|5\d{2})\b/.exec(text);
  if (statusMatch) return statusMatch[1];
  if (/unauthorized|unauthenticated/i.test(text)) return 'unauthorized';
  if (/forbidden/i.test(text)) return 'forbidden';
  if (/expired/i.test(text)) return 'token_expired';
  if (/invalid.*token|token.*invalid/i.test(text)) return 'invalid_token';
  return 'auth_error';
}

/**
 * Register a Sentry event processor that normalises fingerprints for known
 * error categories.  Call once after Sentry.init().
 *
 * Categories handled:
 * - AI provider errors    -> grouped by provider slug
 * - Rate-limit errors     -> collapsed into a single issue
 * - WASM command failures -> grouped by command type
 * - Auth errors           -> grouped by error code
 * - Generation failures   -> grouped by asset type (sprite, model, sfx...)
 */
export function configureSentryFingerprinting(): void {
  Sentry.addEventProcessor((event: Sentry.Event): Sentry.Event => {
    const message =
      event.message ??
      event.exception?.values?.[0]?.value ??
      '';

    // 1. Rate-limit errors -- all collapse into one issue regardless of endpoint
    if (/rate.?limit|too many requests|429/i.test(message)) {
      event.fingerprint = ['rate-limit-error'];
      return event;
    }

    // 2. Auth errors -- grouped by error code so each code is its own issue
    if (/auth|unauthorized|forbidden|401|403|token/i.test(message)) {
      const code = extractAuthCode(message);
      event.fingerprint = ['auth-error', code];
      return event;
    }

    // 3. AI provider errors -- grouped by provider so noise from one provider
    //    does not pollute issues for another
    const provider = extractProvider(message);
    if (provider) {
      event.fingerprint = ['ai-provider-error', provider];
      return event;
    }

    // 4. WASM command failures -- grouped by command type, not full error text
    if (/wasm|handle_command|engine.*command|command.*failed/i.test(message)) {
      const commandType = extractCommandType(message);
      event.fingerprint = ['wasm-command-failure', commandType];
      return event;
    }

    // 5. Generation failures -- grouped by asset type
    if (/generat|generation|asset.*fail|fail.*asset/i.test(message)) {
      const genType = extractGenerationType(message) ?? 'unknown';
      event.fingerprint = ['generation-failure', genType];
      return event;
    }

    // All other events: let Sentry use its default fingerprinting
    return event;
  });
}

// Export helpers for testing
export { extractProvider, extractGenerationType, extractCommandType, extractAuthCode };
