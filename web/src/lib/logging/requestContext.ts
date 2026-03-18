/**
 * Helpers for extracting request context used in structured log entries.
 *
 * Usage:
 *   import { extractRequestId, extractUserId } from '@/lib/logging/requestContext';
 *
 *   export async function POST(req: NextRequest) {
 *     const requestId = extractRequestId(req.headers);
 *     const reqLog = logger.child({ requestId });
 *     reqLog.info('Handling POST /api/publish');
 *   }
 */

import type { ReadonlyHeaders } from 'next/dist/server/web/spec-extension/adapters/headers';

/**
 * Extract an existing request ID from standard headers, or generate a lightweight
 * pseudo-random ID for correlation. Generated IDs are prefixed with "req_" so
 * they are distinguishable from forwarded IDs in logs.
 *
 * Checks (in order):
 *   x-request-id  — set by many API gateways / reverse proxies
 *   x-vercel-id   — Vercel edge request identifier
 *   x-trace-id    — generic tracing header
 */
export function extractRequestId(headers: ReadonlyHeaders | Headers): string {
  const candidates = ['x-request-id', 'x-vercel-id', 'x-trace-id'];
  for (const name of candidates) {
    const value = headers.get(name);
    if (value) return value;
  }
  return generateRequestId();
}

/**
 * Extract a userId from an AuthContext-like object if available.
 * Returns undefined when auth has not been resolved yet.
 */
export function extractUserId(
  authCtx: { user?: { id?: string }; clerkId?: string } | null | undefined,
): string | undefined {
  if (!authCtx) return undefined;
  return authCtx.user?.id ?? authCtx.clerkId;
}

/**
 * Generate a short pseudo-random request ID.
 * Not cryptographically secure — used only for log correlation.
 */
function generateRequestId(): string {
  // Use crypto.randomUUID when available (Node 14.17+, Vercel Edge)
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return `req_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }
  // Fallback: timestamp + Math.random (non-security path, log IDs only)
  const ts = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  return `req_${ts}${rand}`;
}
