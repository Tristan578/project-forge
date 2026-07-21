import { captureException } from '@/lib/monitoring/sentry-server';

/**
 * Server-side PostHog feature flags — a SAFE SUBSET local evaluator (PF-971 / #8952).
 *
 * Deliberately does NOT `import 'server-only'`. `getBooleanFlag` is called from
 * `@/lib/ai/deepTier`, which is itself imported into client-bundled code (the
 * in-editor AI orchestrator chat flow: `OrchestratorPanel.tsx` -> `chat/executor.ts`
 * -> `worldHandlers.ts` -> `worldBuilder.ts` -> `deepTier.ts`). The `server-only`
 * sentinel throws at *bundle* time for any module reachable from a Client
 * Component, which would break that real build target, not just tests. Safety
 * instead comes from `isFlagEvaluationEnabled()`: `POSTHOG_PERSONAL_API_KEY` is
 * NOT a `NEXT_PUBLIC_` var, so Next.js statically replaces it with `undefined`
 * in the client bundle — the check returns false, `getBooleanFlag` returns the
 * caller's fallback synchronously, and `primeFlagsCache()`'s `fetch` never runs
 * in the browser. Same reasoning applies to `sentry-server.ts` above, which is
 * also deliberately `server-only`-free for this reason.
 *
 * We deliberately do NOT install `posthog-node` or reimplement PostHog's full
 * local-evaluation matrix (percentage-rollout hashing, multi-operator property
 * filters, multivariate payloads). `posthog-server.ts`'s header documents why a
 * new runtime dependency is avoided here (Sentry owns the server OTel provider;
 * a new dependency risks the single-root-lockfile / Node-24-relock class of CI
 * breakage — see #8655/#8658). Flag evaluation is lower-stakes than that: we
 * only need two boolean decisions (the deep-tier toggle, per-provider kill
 * switches), so a small subset evaluator is enough and keeps this module
 * dependency-free.
 *
 * DORMANT unless `POSTHOG_PERSONAL_API_KEY` AND `NEXT_PUBLIC_POSTHOG_KEY` are
 * both set. Absent either, `getBooleanFlag()` returns the caller's default and
 * issues ZERO network requests.
 *
 * SUPPORTED SUBSET — a flag is evaluated locally only when its definition is:
 *   - `active: false` → always resolves to `false` (a definitive decision).
 *   - `active: true` with exactly one filter group that has:
 *       - no property filters, and `rollout_percentage` is null/undefined/100
 *         → always `true`; or `rollout_percentage === 0` → always `false`.
 *       - OR exactly one property filter on `tier` with operator `exact` and
 *         `rollout_percentage` null/undefined/100 → matched against the
 *         `tier` passed in `FlagContext` (if omitted, unsupported).
 *   - Multivariate flags, multiple filter groups, percentage rollouts other
 *     than 0/100, and any other property operator are OUTSIDE the subset.
 *
 * Anything outside the subset is treated as "no decision": the caller's
 * default is returned and a single warn-level log is emitted per flag key
 * (not per call) so unsupported targeting doesn't spam logs.
 *
 * Evaluation reads ONLY the in-memory cache and is synchronous — it must
 * never sit in the request hot path. There is no timer or poll loop: the
 * cache is populated by `primeFlagsCache()` (awaited once per server start
 * from `instrumentation.ts` `register()`) and kept warm by a fire-and-forget
 * background refresh that `getBooleanFlag` schedules whenever the cache is
 * older than `POLL_TTL_MS`. Both use a tight fetch timeout; a refresh failure
 * keeps the last-known-good cache rather than clearing it, and a malformed
 * response fails open (defaults, not a throw).
 *
 * `isProviderKilled()` layers a second consumer on the same evaluator: a
 * per-provider kill switch (`provider-kill-switch-<provider>`, PF-971 /
 * #8952) that `createGenerationHandler` checks before any cache lookup or
 * token deduction. Same fail-open contract — dormant unless flag evaluation
 * is configured, defaults to `false` (not killed) on any unsupported/missing
 * flag.
 */

const LOCAL_EVALUATION_URL = 'https://us.i.posthog.com/api/feature_flag/local_evaluation';

/** Hard ceiling on the poll fetch. Never allowed to block a request. */
const POLL_TIMEOUT_MS = 1000;

/** Cache is considered fresh for this long before a background refresh is scheduled. */
const POLL_TTL_MS = 30_000;

export interface FlagContext {
  tier?: string;
}

interface PostHogFlagProperty {
  key: string;
  operator?: string;
  value?: unknown;
}

interface PostHogFlagGroup {
  properties?: PostHogFlagProperty[];
  rollout_percentage?: number | null;
}

interface PostHogFlagFilters {
  groups?: PostHogFlagGroup[];
  multivariate?: unknown;
}

interface PostHogFlag {
  key: string;
  active: boolean;
  filters?: PostHogFlagFilters;
}

interface LocalEvaluationResponse {
  flags?: PostHogFlag[];
}

interface FlagCache {
  flagsByKey: Map<string, PostHogFlag>;
  fetchedAt: number;
}

let cache: FlagCache | null = null;
let refreshInFlight: Promise<void> | null = null;
const warnedUnsupportedKeys = new Set<string>();

/**
 * True only when both the personal API key (for local-evaluation auth) and
 * the project key (query param) are present. No code path activates polling
 * otherwise.
 */
export function isFlagEvaluationEnabled(): boolean {
  return !!process.env.POSTHOG_PERSONAL_API_KEY && !!process.env.NEXT_PUBLIC_POSTHOG_KEY;
}

/**
 * Fetch the local-evaluation payload and replace the cache. NEVER throws —
 * every failure (network, non-2xx, malformed JSON) is reported to Sentry and
 * leaves the previous cache (if any) untouched, i.e. fails open.
 *
 * This is the cache's primary population path: `instrumentation.ts`
 * `register()` awaits it once per server start, so cold instances hold real
 * flag state before the first request. Also exported so tests can await a
 * deterministic refresh instead of relying on the fire-and-forget background
 * scheduling in `getBooleanFlag`.
 */
export async function primeFlagsCache(): Promise<void> {
  if (!isFlagEvaluationEnabled()) return;

  try {
    const projectKey = process.env.NEXT_PUBLIC_POSTHOG_KEY as string;
    const personalKey = process.env.POSTHOG_PERSONAL_API_KEY as string;
    const url = `${LOCAL_EVALUATION_URL}?token=${encodeURIComponent(projectKey)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${personalKey}` },
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`local_evaluation responded with status ${res.status}`);
    }

    const data = (await res.json()) as LocalEvaluationResponse;
    const flagsByKey = new Map<string, PostHogFlag>();
    for (const flag of data.flags ?? []) {
      if (flag?.key) flagsByKey.set(flag.key, flag);
    }
    cache = { flagsByKey, fetchedAt: Date.now() };
  } catch (err) {
    captureException(err, { route: 'posthog_flags', phase: 'poll' });
    // Deliberately do NOT clear `cache` — keep the last-known-good values.
  }
}

function scheduleBackgroundRefreshIfStale(): void {
  if (!isFlagEvaluationEnabled() || refreshInFlight) return;
  const isStale = !cache || Date.now() - cache.fetchedAt > POLL_TTL_MS;
  if (!isStale) return;

  refreshInFlight = primeFlagsCache().finally(() => {
    refreshInFlight = null;
  });
}

function warnUnsupported(key: string): void {
  if (warnedUnsupportedKeys.has(key)) return;
  warnedUnsupportedKeys.add(key);
  console.warn(
    `[posthogFlags] flag "${key}" uses targeting outside the supported safe subset ` +
      '(percentage rollout, multiple groups, or an unsupported property operator) — ' +
      'falling back to the caller-provided default.',
  );
}

type GroupResult = boolean | 'unsupported';

function evaluateGroup(group: PostHogFlagGroup, context: FlagContext | undefined): GroupResult {
  const properties = group.properties ?? [];
  const rollout = group.rollout_percentage;
  const isFullRollout = rollout === null || rollout === undefined || rollout === 100;

  if (properties.length === 0) {
    if (isFullRollout) return true;
    if (rollout === 0) return false;
    return 'unsupported';
  }

  if (properties.length === 1 && isFullRollout) {
    const [prop] = properties;
    if (prop.key === 'tier' && prop.operator === 'exact') {
      if (!context || context.tier === undefined) return 'unsupported';
      const expected = Array.isArray(prop.value) ? prop.value : [prop.value];
      return expected.includes(context.tier);
    }
  }

  return 'unsupported';
}

/**
 * Synchronously evaluate a boolean flag from the in-memory cache. Returns
 * `fallback` whenever: flag evaluation is disabled, the flag is unknown, the
 * flag's targeting falls outside the supported safe subset, or the cache has
 * not been populated yet. Never performs network I/O itself — call
 * `primeFlagsCache()` to populate/refresh the cache; this function only
 * schedules a fire-and-forget background refresh when the cache is stale.
 */
export function getBooleanFlag(key: string, fallback: boolean, context?: FlagContext): boolean {
  if (!isFlagEvaluationEnabled()) return fallback;

  scheduleBackgroundRefreshIfStale();

  const flag = cache?.flagsByKey.get(key);
  if (!flag) return fallback;
  if (flag.active === false) return false;

  const groups = flag.filters?.groups ?? [];
  if (flag.filters?.multivariate || groups.length !== 1) {
    warnUnsupported(key);
    return fallback;
  }

  const result = evaluateGroup(groups[0], context);
  if (result === 'unsupported') {
    warnUnsupported(key);
    return fallback;
  }
  return result;
}

/** Flag-key prefix for per-provider kill switches. */
const PROVIDER_KILL_SWITCH_PREFIX = 'provider-kill-switch-';

/**
 * True when a PostHog flag (`provider-kill-switch-<provider>`) explicitly
 * disables generation for the given provider. Defaults to `false` (not
 * killed) whenever flag evaluation is dormant, the flag is unset, or its
 * targeting falls outside the supported safe subset — a provider is never
 * killed by omission or by evaluator failure.
 */
export function isProviderKilled(provider: string): boolean {
  return getBooleanFlag(`${PROVIDER_KILL_SWITCH_PREFIX}${provider}`, false);
}
