import * as Sentry from '@sentry/nextjs';

/**
 * Valid HTTP auth-related status codes.
 * Only 4xx codes with auth semantics are considered authentication errors.
 * 5xx server errors are NOT auth errors and must not trigger auth fingerprinting.
 */
const AUTH_CODES = new Set([401, 403, 407, 419, 429]);

/**
 * Extract an auth-related HTTP status code from an error message.
 *
 * Only matches 4xx codes that carry auth semantics: 401, 403, 407, 419, 429.
 * 5xx codes (500, 502, 503, 504, etc.) are explicitly excluded — a server
 * error is not an auth failure and must not be grouped under the auth
 * fingerprint.
 *
 * @param message - The error message to inspect
 * @returns The matched auth code number, or null if none found
 */
export function extractAuthCode(message: string): number | null {
  // Match any 3-digit number in the message — then filter to auth codes only.
  // Using a broad digit match first avoids false negatives from strict patterns,
  // then the allowlist ensures we never accept 5xx codes.
  const match = message.match(/\b([45]\d{2})\b/);
  if (!match) return null;

  const code = parseInt(match[1], 10);
  return AUTH_CODES.has(code) ? code : null;
}

/**
 * Configure Sentry event fingerprinting.
 *
 * Groups errors with consistent fingerprints so that related issues are
 * de-duplicated in Sentry rather than creating dozens of separate issues.
 *
 * Rules applied (in priority order):
 * 1. Auth errors (401/403/407/419/429) — grouped by auth code so all
 *    "Unauthorized" errors are one issue, not thousands.
 * 2. Network errors (fetch failures, CORS) — grouped by error type.
 * 3. All other errors — fall through to Sentry's default fingerprinting.
 *
 * Call this immediately after `Sentry.init()` in every Sentry config file
 * (client, server, edge).
 */
export function configureSentryFingerprinting(): void {
  Sentry.addEventProcessor((event) => {
    // Collect candidate strings to inspect: exception message + exception type
    const candidateMessages: string[] = [];

    const exceptions = event.exception?.values ?? [];
    for (const ex of exceptions) {
      if (ex.value) candidateMessages.push(ex.value);
      if (ex.type) candidateMessages.push(ex.type);
    }

    // Also check the top-level message
    if (event.message) candidateMessages.push(event.message);

    // Rule 1: Auth errors — only 4xx auth codes
    for (const msg of candidateMessages) {
      const authCode = extractAuthCode(msg);
      if (authCode !== null) {
        event.fingerprint = ['auth-error', String(authCode)];
        return event;
      }
    }

    // Rule 2: Network errors
    const networkPatterns = [
      /network\s+error/i,
      /failed\s+to\s+fetch/i,
      /cors/i,
      /net::/i,
    ];
    for (const msg of candidateMessages) {
      if (networkPatterns.some((re) => re.test(msg))) {
        event.fingerprint = ['network-error', '{{ default }}'];
        return event;
      }
    }

    // Rule 3: Default Sentry fingerprinting
    return event;
  });
}
