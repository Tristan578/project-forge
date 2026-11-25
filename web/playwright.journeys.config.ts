/**
 * Playwright config for the DB-backed engine journeys gate (#10161).
 *
 * test-e2e-engine-smoke drives /dev, which bypasses the database by design, so
 * the account journeys of #9723 — save a game and reopen it in a fresh session
 * (#10153), publish it and play it signed out (#10154) — cannot run there. This
 * config is theirs: the same NEXT_PUBLIC_E2E_HOOKS production build and the
 * same SwiftShader software-WebGL2 flags as playwright.engine.config.ts, served
 * against a Postgres CREATED FOR THIS RUN, migrated with the real `db:migrate`,
 * drift-checked with the real `db:drift`, and reached by the real neon HTTP
 * driver through Neon's documented local proxy
 * (docs/decisions/2026-10-05-engine-journeys-database.md).
 *
 * SELECTOR. A test lands here by carrying the tag `@engine-journey` in its
 * title path, and in no other way: this grep names that tag and nothing else.
 * The smoke config greps `@engine-smoke|@engine-ui` and must never gain this
 * tag (a journey there would run without a database), and a journey spec must
 * not also carry `@ui` (the keyless, database-less @ui shard would try to run
 * it). scripts/__tests__/e2e-tag-routing.test.sh pins all three. Today the only
 * member is e2e/tests/engine-journeys-health.spec.ts, which asserts /api/health
 * reports the per-run database `connected`.
 *
 * VACUITY. A grep that selects zero tests fails in Playwright itself ("No tests
 * found", exit 1), so renaming the tag cannot turn this gate into a green no-op.
 *
 * NOT YET WIRED. The journey evidence reporter (e2e/lib/journeyEvidenceReporter.ts)
 * and the post-run check (scripts/check-journey-evidence.ts) are deliberately
 * absent: the check refuses --min-journeys below 1, and no journey lives here
 * until #10153, which registers the reporter and adds the upload and check steps
 * exactly as test-e2e-engine-smoke has them.
 *
 * Requirements (the CI job handles these):
 *   - web/public/engine-pkg-webgl2/ holds the WebGL2 engine the smoke gate
 *     uploaded (SwiftShader cannot drive WebGPU);
 *   - DATABASE_URL and E2E_NEON_HTTP_ENDPOINT name the per-run database and its
 *     proxy, both on localhost, checked by scripts/assert-e2e-db-host.sh;
 *   - SKIP_ENV_VALIDATION=true on the step that invokes Playwright (the
 *     `next start` webServer inherits that step's env, not the build's).
 *
 * Timeouts are the smoke gate's: E2E_TIMEOUT_ENGINE_FULL_MS per test, because
 * the journeys that follow pay for the same cold WASM boot under software
 * rendering. Both constants live in e2e/constants.ts — no spec may inline a
 * timeout literal.
 */
import { defineConfig, devices } from '@playwright/test';
import { E2E_NAVIGATION_TIMEOUT_MS } from './src/lib/config/timeouts';
import {
  E2E_TIMEOUT_ENGINE_FULL_MS,
  E2E_TIMEOUT_LOAD_MS,
} from './e2e/constants';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  grep: /@engine-journey/,
  fullyParallel: true,
  forbidOnly: true,
  // One retry absorbs a transient software-rendering blip; a genuine break
  // still fails (it fails on the retry too).
  retries: 1,
  // Software rendering is CPU-bound; parallel WASM inits starve each other.
  workers: 1,
  reporter: [['github'], ['html', { open: 'never' }]],
  timeout: E2E_TIMEOUT_ENGINE_FULL_MS,
  expect: { timeout: E2E_TIMEOUT_LOAD_MS },

  use: {
    baseURL: 'http://localhost:3000',
    actionTimeout: E2E_TIMEOUT_LOAD_MS,
    navigationTimeout: E2E_NAVIGATION_TIMEOUT_MS,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // SwiftShader-via-ANGLE software WebGL2, exactly as the smoke gate. Do NOT
    // change to --disable-gpu: that leaves wgpu with no GL context and the
    // engine never reports ready (#8602).
    launchOptions: {
      args: [
        '--no-sandbox',
        '--use-gl=angle',
        '--use-angle=swiftshader-webgl',
        '--enable-unsafe-swiftshader',
      ],
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npx next start',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: false,
    timeout: E2E_TIMEOUT_ENGINE_FULL_MS, // generous: WASM assets are large
  },
});
