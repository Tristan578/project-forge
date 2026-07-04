/**
 * Combine an optional external abort (the generation agent's per-route
 * deadline) with a client's own per-fetch timeout. When no external signal
 * is supplied (flag off, or the inline execute path), this returns exactly
 * AbortSignal.timeout(timeoutMs) — byte-identical to today's behavior.
 *
 * Why safe: AbortSignal.any fires on the FIRST of its inputs, so per-fetch
 * timeouts still bound each request exactly as today; the external deadline
 * can only make cancellation earlier, never later.
 *
 * Requires Node ≥ 20.3 (AbortSignal.any built-in). Repo runs Node 24.
 */
export function composeAbortSignal(
  external: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([external, timeout]) : timeout;
}
