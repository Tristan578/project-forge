/**
 * Platform-generation verification (#9117).
 *
 * Answers, per capability, "with the keys in THIS environment, would a
 * platform-key (non-BYOK) generation request be accepted by its provider?"
 *
 *   1. The route for each capability is decided from `lib/config/providers.ts`
 *      — the same tables `resolveApiKey` and `/api/capabilities` read — so the
 *      script cannot disagree with the product about which key a capability
 *      needs. A capability in `UNAVAILABLE_CAPABILITIES` is reported as such
 *      and never probed.
 *   2. For every configured provider it performs ONE cheap authenticated GET
 *      against that provider's documented account/balance endpoint. These
 *      calls cost no credits; they prove the key is accepted, which is the
 *      property `getPlatformKey()` cannot check (it only sees that the env var
 *      is non-empty). They do NOT prove a generation succeeds end to end —
 *      that is the owner's acceptance step in docs/guides/platform-keys.md.
 *
 * Usage (from the repo root, after `cd web && vercel env pull .env.local`):
 *
 *   node --env-file=web/.env.local web/scripts/verify-platform-generation.ts
 *
 * Exit code 0 when every offered capability passes; 1 when any is missing a
 * key or its provider rejected the key. AI_GATEWAY_API_KEY only ever counts
 * for `chat` — it is not evidence that asset generation works.
 *
 * Runs under plain `node` (Node 24+ type stripping): relative imports carry
 * explicit `.ts` extensions and no `@/` alias is used, same as
 * provision-billing-meter.ts.
 */

import { pathToFileURL } from 'node:url';
import {
  PROVIDER_CAPABILITIES,
  DIRECT_CAPABILITY_PROVIDER,
  PLATFORM_KEY_ENV,
  PLATFORM_KEY_CONSOLE_URL,
  GATEWAY_KEY_ENV,
  getCapabilityUnavailability,
  type ProviderCapability,
  type PlatformKeyProvider,
} from '../src/lib/config/providers.ts';

export type Route = 'platform-key' | 'gateway' | 'unavailable';

export interface PlanRow {
  capability: ProviderCapability;
  /** Provider name from DIRECT_CAPABILITY_PROVIDER, or 'vercel-gateway'. */
  provider: string;
  route: Route;
  /** Env var the route reads, or null when unavailable. */
  envVar: string | null;
  /** Whether that env var is non-empty in the supplied environment. */
  configured: boolean;
  /** Where a human mints the key, when known. */
  consoleUrl: string | null;
  /** Free text: unavailability reason, or notes. */
  detail: string;
}

export type ProbeStatus = 'pass' | 'fail' | 'missing' | 'unavailable' | 'unprobed';

export interface ProbeResult {
  capability: ProviderCapability;
  provider: string;
  route: Route;
  status: ProbeStatus;
  detail: string;
}

export interface Probe {
  method: 'GET';
  url: string;
  /** Build the auth headers from the raw key. */
  headers: (key: string) => Record<string, string>;
  /** The vendor page documenting this endpoint and header. */
  docs: string;
}

const BEARER = (key: string): Record<string, string> => ({ Authorization: `Bearer ${key}` });

/**
 * One credit-free, authenticated GET per provider. Each entry cites the vendor
 * page that documents the endpoint and header, so the contract pinned by the
 * tests is the provider's, not ours (lesson 14). `null` = not probeable:
 * Suno has no API, Hyper3D is BYOK-only and never served by a platform key.
 */
export const PROVIDER_PROBES: Record<PlatformKeyProvider, Probe | null> = {
  anthropic: {
    method: 'GET',
    url: 'https://api.anthropic.com/v1/models',
    headers: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
    docs: 'https://docs.anthropic.com/en/api/models-list',
  },
  meshy: {
    method: 'GET',
    url: 'https://api.meshy.ai/openapi/v1/balance',
    headers: BEARER,
    docs: 'https://docs.meshy.ai/en/api/balance',
  },
  elevenlabs: {
    method: 'GET',
    url: 'https://api.elevenlabs.io/v1/user',
    headers: (key) => ({ 'xi-api-key': key }),
    docs: 'https://elevenlabs.io/docs/api-reference/user/get',
  },
  openai: {
    method: 'GET',
    url: 'https://api.openai.com/v1/models',
    headers: BEARER,
    docs: 'https://platform.openai.com/docs/api-reference/models/list',
  },
  replicate: {
    method: 'GET',
    url: 'https://api.replicate.com/v1/account',
    headers: BEARER,
    docs: 'https://replicate.com/docs/reference/http#get-account',
  },
  removebg: {
    method: 'GET',
    url: 'https://api.remove.bg/v1.0/account',
    headers: (key) => ({ 'X-Api-Key': key }),
    docs: 'https://www.remove.bg/api#account-balance',
  },
  hyper3d: null,
  suno: null,
};

/** The gateway's authenticated, credit-free endpoint (serves `chat` only here). */
export const GATEWAY_PROBE: Probe = {
  method: 'GET',
  url: 'https://ai-gateway.vercel.sh/v1/credits',
  headers: BEARER,
  docs: 'https://vercel.com/docs/ai-gateway/authentication',
};

const GATEWAY_PROVIDER = 'vercel-gateway';

/**
 * Decide the route and configuration state of every capability from the
 * supplied environment. Pure: no I/O, so it is unit-testable against any env.
 */
export function buildPlan(env: Readonly<Record<string, string | undefined>>): PlanRow[] {
  return PROVIDER_CAPABILITIES.map((capability): PlanRow => {
    const unavailability = getCapabilityUnavailability(capability);
    const provider = DIRECT_CAPABILITY_PROVIDER[capability];
    if (unavailability) {
      return {
        capability,
        provider,
        route: 'unavailable',
        envVar: null,
        configured: false,
        consoleUrl: null,
        detail: `${unavailability.reason} (#${unavailability.issue})`,
      };
    }

    // Only chat is served by the gateway in code today (lib/providers/registry).
    // #9523 tracks routing image/embedding through it; until that lands the
    // gateway key is NOT evidence for anything but chat.
    if (capability === 'chat' && env[GATEWAY_KEY_ENV.vercelGateway]) {
      return {
        capability,
        provider: GATEWAY_PROVIDER,
        route: 'gateway',
        envVar: GATEWAY_KEY_ENV.vercelGateway,
        configured: true,
        consoleUrl: 'https://vercel.com/docs/ai-gateway',
        detail: 'chat is served by the Vercel AI Gateway',
      };
    }

    const platformProvider = provider as PlatformKeyProvider;
    const envVar = PLATFORM_KEY_ENV[platformProvider];
    return {
      capability,
      provider,
      route: 'platform-key',
      envVar,
      configured: Boolean(env[envVar]),
      consoleUrl: PLATFORM_KEY_CONSOLE_URL[platformProvider] ?? null,
      detail: '',
    };
  });
}

export interface VerifyOptions {
  fetchImpl?: typeof fetch;
  env?: Readonly<Record<string, string | undefined>>;
  timeoutMs?: number;
}

/**
 * Probe each configured provider once and map the outcome onto every
 * capability it serves. Never throws: a thrown probe is a `fail` row.
 */
export async function runVerification(
  plan: PlanRow[],
  options: VerifyOptions = {},
): Promise<ProbeResult[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const memo = new Map<string, Promise<{ status: ProbeStatus; detail: string }>>();

  async function probeOnce(row: PlanRow): Promise<{ status: ProbeStatus; detail: string }> {
    const probe: Probe | null =
      row.route === 'gateway'
        ? GATEWAY_PROBE
        : PROVIDER_PROBES[row.provider as PlatformKeyProvider] ?? null;
    if (!probe) {
      return { status: 'unprobed', detail: `${row.provider} has no credit-free probe endpoint` };
    }
    const key = row.envVar ? env[row.envVar] : undefined;
    if (!key) {
      return { status: 'missing', detail: `${row.envVar} is not set` };
    }
    try {
      const res = await fetchImpl(probe.url, {
        method: probe.method,
        headers: probe.headers(key),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        return { status: 'pass', detail: `${res.status} ${probe.method} ${probe.url}` };
      }
      return { status: 'fail', detail: `${res.status} from ${probe.method} ${probe.url}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: 'fail', detail: `${probe.method} ${probe.url} threw: ${message}` };
    }
  }

  const results: ProbeResult[] = [];
  for (const row of plan) {
    if (row.route === 'unavailable') {
      results.push({ ...pick(row), status: 'unavailable', detail: row.detail });
      continue;
    }
    if (!row.configured) {
      results.push({
        ...pick(row),
        status: 'missing',
        detail: `${row.envVar} is not set${row.consoleUrl ? ` — mint one at ${row.consoleUrl}` : ''}`,
      });
      continue;
    }
    const memoKey = `${row.route}:${row.provider}`;
    let pending = memo.get(memoKey);
    if (!pending) {
      pending = probeOnce(row);
      memo.set(memoKey, pending);
    }
    const outcome = await pending;
    results.push({ ...pick(row), ...outcome });
  }
  return results;
}

function pick(row: PlanRow): Pick<ProbeResult, 'capability' | 'provider' | 'route'> {
  return { capability: row.capability, provider: row.provider, route: row.route };
}

/** Fixed-width table, one line per capability. */
export function formatTable(results: ProbeResult[]): string {
  const header = ['capability', 'provider', 'route', 'status', 'detail'];
  const rowsOut = results.map((r) => [r.capability, r.provider, r.route, r.status, r.detail]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rowsOut.map((r) => r[i].length)),
  );
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...rowsOut.map(line)].join('\n');
}

/** Windows-safe "am I the entry module" check (see provision-billing-meter.ts). */
export function isMainModule(metaUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  return metaUrl === pathToFileURL(argv1).href;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const plan = buildPlan(process.env);
  const results = await runVerification(plan);
  console.log(formatTable(results));
  const failing = results.filter((r) => r.status === 'fail' || r.status === 'missing');
  const offered = results.filter((r) => r.status !== 'unavailable');
  console.log(
    `\n${offered.length - failing.length}/${offered.length} offered capabilities verified; ` +
      `${results.length - offered.length} declared unavailable.`,
  );
  process.exit(failing.length > 0 ? 1 : 0);
}
