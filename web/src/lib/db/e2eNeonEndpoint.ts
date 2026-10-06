/**
 * E2E-only override of the Neon HTTP endpoint (#10161).
 *
 * WHY THIS EXISTS
 * ---------------
 * The app talks to Postgres through `@neondatabase/serverless`'s HTTP client
 * (`neon(DATABASE_URL)`), which does not open a TCP connection to the host in
 * the URL: it POSTs each query to `https://<host-with-api.-prefix>/sql` and
 * sends the connection string in a header. So a Postgres that CI creates for
 * one run is unreachable to the real driver unless the driver is told where
 * the Neon-protocol endpoint for that database is. The CI engine-journeys job
 * runs Neon's documented local proxy in front of a service container and sets
 * `E2E_NEON_HTTP_ENDPOINT=http://localhost:4444/sql`
 * (docs/decisions/2026-10-05-engine-journeys-database.md).
 *
 * THE GATE
 * --------
 * The variable is honoured ONLY when `e2eHooksEnabled()` is true — the same
 * build-time gate that exposes the editor's test hooks. `NEXT_PUBLIC_E2E_HOOKS`
 * is inlined by `next build`, so a production build without it folds the gate
 * to `false` and never reads `E2E_NEON_HTTP_ENDPOINT`, whatever the runtime
 * environment says. A `tsx` script (db:migrate, db:drift) is not a production
 * build, so there the gate is open and the same variable reaches the same
 * proxy. `e2eNeonEndpoint.test.ts` pins both the behaviour and the source
 * shape, because no runtime test can see a build-time inline.
 *
 * DEFENCE IN DEPTH. Even with the gate open the endpoint must be a loopback
 * `/sql` URL: the override exists to reach a proxy on the same machine, and a
 * value that would send queries anywhere else is refused loudly rather than
 * applied or silently ignored. Silence here would mean a journeys job that
 * quietly ran against Neon cloud with a green board.
 *
 * `neonConfig.fetchEndpoint` is a process-global the driver reads at QUERY
 * time, so one call before the first query covers every client in the process.
 * Every `neon(` construction site still calls `applyE2eNeonEndpointOverride()`
 * itself — the test walks `src/` and `scripts/` and fails on one that does not
 * — so no site depends on another having run first.
 *
 * No `server-only` import: the `tsx` scripts under `web/scripts/` call this
 * too, and that marker throws outside a React Server Components build.
 */
import { neonConfig } from '@neondatabase/serverless';
import { e2eHooksEnabled } from '../e2e/testHooks';

/** The environment variable the override reads. */
export const E2E_NEON_HTTP_ENDPOINT_ENV = 'E2E_NEON_HTTP_ENDPOINT';

/** Hosts the override may point at. `[::1]` is how `URL` reports IPv6 loopback. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Decide, with no side effects, whether the override applies and to what.
 *
 * @param rawValue The variable's value (`process.env.E2E_NEON_HTTP_ENDPOINT`).
 * @param hooksEnabled The build-time gate (`e2eHooksEnabled()`).
 * @returns The endpoint to install, or `null` when the override must not apply.
 * @throws When the gate is open and the value is set but is not a loopback
 *   `http(s)://…/sql` URL — a misconfiguration must fail, never fall back.
 */
export function resolveE2eNeonEndpoint(
  rawValue: string | undefined,
  hooksEnabled: boolean,
): string | null {
  if (!hooksEnabled) return null;
  if (rawValue === undefined || rawValue === '') return null;

  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error(`${E2E_NEON_HTTP_ENDPOINT_ENV} is not a URL: ${JSON.stringify(rawValue)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `${E2E_NEON_HTTP_ENDPOINT_ENV} must be an http(s) URL; got scheme '${url.protocol}'`,
    );
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      `${E2E_NEON_HTTP_ENDPOINT_ENV} must point at a loopback host (localhost, 127.0.0.1 or [::1]); got host '${url.hostname}'`,
    );
  }
  if (url.pathname !== '/sql') {
    throw new Error(
      `${E2E_NEON_HTTP_ENDPOINT_ENV} must end in the Neon HTTP query path /sql; got path '${url.pathname}'`,
    );
  }
  return rawValue;
}

/**
 * Install the override on the driver when the gate is open and the variable
 * is set. Call it before constructing a `neon()` client.
 *
 * @returns The endpoint installed, or `null` when the driver was left on its
 *   default (Neon cloud) endpoint.
 */
export function applyE2eNeonEndpointOverride(): string | null {
  const endpoint = resolveE2eNeonEndpoint(process.env.E2E_NEON_HTTP_ENDPOINT, e2eHooksEnabled());
  if (endpoint !== null) {
    neonConfig.fetchEndpoint = endpoint;
  }
  return endpoint;
}
