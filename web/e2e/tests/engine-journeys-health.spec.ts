import { expect, test } from '@playwright/test';

/**
 * Health of the DB-backed engine journeys gate (#10161).
 *
 * test-e2e-engine-journeys serves the production build against a Postgres
 * created for that run, reached by the real neon HTTP driver through Neon's
 * local proxy (docs/decisions/2026-10-05-engine-journeys-database.md). This
 * spec is the job's proof that the server under test actually talks to that
 * database: `/api/health` runs `SELECT 1` through the same `neon()` client and
 * the same `applyE2eNeonEndpointOverride()` the app's queries go through, and
 * reports `database: 'connected'` ONLY when that probe succeeded —
 * `not_configured` when DATABASE_URL is absent, `unavailable` when the query
 * failed.
 *
 * Only the FIRST test is that database gate: it is the one assertion in this
 * file that reads the database result, and it cannot pass against a server with
 * no database, which is what makes it a gate rather than a label
 * (lessons-learned 1 and 11). The SECOND test is not a database check. It
 * asserts the server under test is THIS run's build (its `commit` equals the
 * run's SHA) and reads nothing from the database: against a server whose
 * DATABASE_URL is unset, `/api/health` reports `database: 'not_configured'`, a
 * `degraded` critical service, which is still HTTP 200 with `status: 'ok'`, so
 * that test would pass. It sits beside the gate as a build-identity check, not
 * as a second proof of the database.
 *
 * `@engine-journey` is the selector of playwright.journeys.config.ts; it is
 * carried on the describe title so every test in this file is selected. The
 * journeys that follow (#10153, #10154) use the same tag.
 */

/** The per-service name the health report gives the database probe. */
const DATABASE_SERVICE_NAME = 'Database (Neon)';

/**
 * The commit the server under test should report. CI starts `next start` with
 * VERCEL_GIT_COMMIT_SHA = github.sha (= GITHUB_SHA) and `/api/health` exposes
 * its first 8 characters; locally neither is set and the server reports
 * `local`. Same derivation as journey-evidence-canary.spec.ts.
 */
const EXPECTED_SERVER_COMMIT = (
  process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'local'
).slice(0, 8);

interface PublicServiceHealth {
  name: string;
  status: string;
}

interface HealthBody {
  status: string;
  commit: string;
  database: string;
  services: PublicServiceHealth[];
}

test.describe('Engine journeys database health @engine-journey', () => {
  test('/api/health reports the per-run database connected', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status(), await response.text()).toBe(200);

    const body = (await response.json()) as HealthBody;
    expect(body.database, JSON.stringify(body)).toBe('connected');

    // The per-service entry behind that summary field: `up` is the public
    // spelling of an internal `healthy`, which the probe returns only after
    // SELECT 1 answered and the circuit breaker is closed.
    const database = body.services.find((service) => service.name === DATABASE_SERVICE_NAME);
    expect(database?.status, `services: ${JSON.stringify(body.services)}`).toBe('up');

    // Database and auth are the two critical services; a `down` database would
    // have made this a 503 with status `error`.
    expect(body.status).toBe('ok');
  });

  test("/api/health reports this run's commit", async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status(), await response.text()).toBe(200);

    const body = (await response.json()) as HealthBody;
    expect(body.commit).toBe(EXPECTED_SERVER_COMMIT);
  });
});
