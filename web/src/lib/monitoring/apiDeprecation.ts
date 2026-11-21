/**
 * API Deprecation Header Monitor
 *
 * Checks HTTP responses for standard deprecation signals and logs
 * warnings so the team can act before APIs are removed.
 *
 * Signals checked:
 *   - `Deprecation` header (RFC 8594) — ISO timestamp or "true"
 *   - `Sunset` header (RFC 8594) — ISO timestamp of planned removal
 *   - `Warning` header — 299 "Miscellaneous Persistent Warning" and
 *     214 "Transformation Applied" codes that indicate deprecation
 *
 * Usage:
 *   const response = await fetch(url);
 *   checkDeprecationHeaders(response, 'Meshy 3D API');
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeprecationInfo {
  /** True if any deprecation signal was found. */
  deprecated: boolean;
  /** ISO timestamp or "true" from the Deprecation header, if present. */
  deprecation?: string;
  /** ISO timestamp from the Sunset header, if present (planned removal date). */
  sunset?: string;
  /** Warning header values that contain deprecation-related codes. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Warning codes that indicate deprecation / upcoming removal
// See: https://www.rfc-editor.org/rfc/rfc7234#section-5.5
// ---------------------------------------------------------------------------

/** 299 = Miscellaneous persistent warning — used for deprecation notices. */
const WARNING_CODE_MISCELLANEOUS = '299';
/** 214 = Transformation applied — occasionally used for deprecation signalling. */
const WARNING_CODE_TRANSFORMATION = '214';

const DEPRECATION_WARNING_CODES = new Set([
  WARNING_CODE_MISCELLANEOUS,
  WARNING_CODE_TRANSFORMATION,
]);

// ---------------------------------------------------------------------------
// Header parsing helpers
// ---------------------------------------------------------------------------

/**
 * Extract Warning header values that contain known deprecation codes.
 * A Warning header may contain multiple comma-separated entries, each
 * with the format: `<code> <agent> "<text>" [<date>]`
 */
function extractDeprecationWarnings(warningHeader: string | null): string[] {
  if (!warningHeader) return [];

  // Split on comma boundaries that are not inside quoted strings
  const entries = splitWarningHeader(warningHeader);
  return entries.filter((entry) => {
    const trimmed = entry.trim();
    const code = trimmed.split(/\s/)[0];
    return DEPRECATION_WARNING_CODES.has(code);
  });
}

/**
 * Naively split a Warning header on commas that appear outside quoted strings.
 * RFC 7234 allows multiple warnings in one header separated by commas.
 */
function splitWarningHeader(header: string): string[] {
  const entries: string[] = [];
  let current = '';
  let inQuote = false;

  for (let i = 0; i < header.length; i++) {
    const ch = header[i];
    if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
    } else if (ch === ',' && !inQuote) {
      entries.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    entries.push(current);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Check an HTTP response for deprecation signals.
 *
 * Logs a `console.warn` for each signal found. If Sentry is available in
 * the current environment, also calls `captureMessage` so the deprecation
 * is tracked in the error dashboard.
 *
 * @param response - The fetch Response to inspect (headers only — body untouched).
 * @param apiName  - Human-readable name of the API being called, used in log messages.
 * @returns        - Structured deprecation info. `deprecated` is false when no signals found.
 */
export function checkDeprecationHeaders(
  response: Response,
  apiName: string,
): DeprecationInfo {
  const deprecationHeader = response.headers.get('Deprecation');
  const sunsetHeader = response.headers.get('Sunset');
  const warningHeader = response.headers.get('Warning');

  const warnings = extractDeprecationWarnings(warningHeader);
  const deprecated = !!(deprecationHeader || sunsetHeader || warnings.length > 0);

  if (!deprecated) {
    return { deprecated: false, warnings: [] };
  }

  const info: DeprecationInfo = {
    deprecated: true,
    warnings,
  };

  if (deprecationHeader) {
    info.deprecation = deprecationHeader;
  }
  if (sunsetHeader) {
    info.sunset = sunsetHeader;
  }

  // Build a human-readable message for logging
  const parts: string[] = [`[apiDeprecation] "${apiName}" has deprecation signals:`];
  if (deprecationHeader) {
    parts.push(`  Deprecation: ${deprecationHeader}`);
  }
  if (sunsetHeader) {
    parts.push(`  Sunset (planned removal): ${sunsetHeader}`);
  }
  for (const w of warnings) {
    parts.push(`  Warning: ${w.trim()}`);
  }

  const message = parts.join('\n');
  console.warn(message);

  // Optionally report to Sentry — import is dynamic to avoid pulling in
  // server-only modules in browser contexts.
  reportToSentry(apiName, info, message);

  return info;
}

// ---------------------------------------------------------------------------
// Sentry integration (optional, best-effort)
// ---------------------------------------------------------------------------

/**
 * Attempt to report a deprecation notice to Sentry.
 * Silently skipped if Sentry is not available in the current context.
 */
function reportToSentry(
  apiName: string,
  info: DeprecationInfo,
  message: string,
): void {
  // Use dynamic import to avoid hard dependency on Sentry in browser bundles.
  // We fire-and-forget — the caller should not need to await Sentry reporting.
  if (typeof window !== 'undefined') {
    // Browser: use the client-side Sentry bundle if loaded
    import('@sentry/nextjs')
      .then((Sentry) => {
        Sentry.captureMessage(message, {
          level: 'warning',
          tags: { api: apiName, type: 'api_deprecation' },
          extra: {
            deprecation: info.deprecation,
            sunset: info.sunset,
            warnings: info.warnings,
          },
        });
      })
      .catch(() => {
        // Sentry not available — already warned via console.warn above
      });
  }
}
