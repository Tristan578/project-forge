/**
 * Playwright config for the per-PR @engine-smoke gate (#8602 / F10).
 *
 * This is the FIRST per-PR job that actually boots the WASM engine. Every other
 * CI Playwright config (ci, journey, smoke) launches Chromium with
 * `--disable-gpu`, which leaves the Rust/Bevy/wgpu renderer with no GL context —
 * so `init_engine()` never completes and `__FORGE_ENGINE_READY` never flips
 * (see web/e2e/fixtures/editor.fixture.ts `load()` comment). Those configs can
 * therefore only run store-less `@ui` / `@journey` specs.
 *
 * The make-or-break difference here is the launch flags: we use ANGLE's
 * SwiftShader software-WebGL2 backend instead of disabling the GPU, which gives
 * wgpu a real (software) GL2 context to initialise against:
 *   --use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader
 * (`--enable-unsafe-swiftshader` is required on recent Chromium or SwiftShader
 * WebGL is refused). This validates the ECS / picking / play / export journeys
 * end-to-end through the real engine.
 *
 * DOCUMENTED GAP — SwiftShader is SOFTWARE WebGL2, NOT WebGPU. This job does NOT
 * validate the WebGPU code path or real-GPU rendering correctness (e.g. the
 * pink-material / `tonemapping_luts` class of bugs). Those still require a
 * GPU-capable runner and are out of per-PR scope. See
 * docs/audits/2026-05-30-security-testing-audit.md (F10) and
 * docs/testing-principles.md.
 *
 * Requirements (the CI job handles these):
 *   - The WebGL2 WASM binaries are built and copied into
 *     web/public/engine-pkg-webgl2/ BEFORE this runs (SwiftShader cannot drive
 *     WebGPU, so only the webgl2 variant is needed).
 *   - The editor.fixture `load()` seeds localStorage['forge:preferred-backend']
 *     = 'webgl2' so loadWasm() forces WebGL2 and never spends GPU_INIT_TIMEOUT
 *     probing WebGPU first.
 *   - SKIP_ENV_VALIDATION=true (no Clerk/Stripe keys in CI).
 *
 * Timeouts are deliberately generous: software rendering + WASM load + Bevy init
 * is slow, so a too-tight cap would produce flaky reds that masquerade as real
 * regressions. We reuse E2E_TIMEOUT_ENGINE_FULL_MS (90s) for the per-test cap.
 */
import { defineConfig, devices } from '@playwright/test';
import { E2E_NAVIGATION_TIMEOUT_MS } from './src/lib/config/timeouts';
import {
  E2E_TIMEOUT_ENGINE_FULL_MS,
  E2E_TIMEOUT_LOAD_MS,
} from './e2e/constants';

export default defineConfig({
  testDir: './e2e',
  // Match ONLY the curated engine-smoke spec so a slow @engine spec elsewhere
  // can't blow this job's budget. `grep` is a belt-and-suspenders tag filter.
  testMatch: '**/engine-smoke.spec.ts',
  grep: /@engine-smoke/,
  fullyParallel: true,
  forbidOnly: true,
  // One retry absorbs a transient software-rendering blip; a genuine engine
  // break still fails (it fails on the retry too) — this does NOT mask real
  // regressions, it only de-flakes the slow SwiftShader path.
  retries: 1,
  // Software rendering is CPU-bound; keep workers low so parallel WASM inits
  // don't starve each other and trip the engine-ready timeout.
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
    // SwiftShader-via-ANGLE software WebGL2 — the whole point of this config.
    // Do NOT change to --disable-gpu: that is what makes the engine hang in the
    // other configs and is the exact bug #8602 fixes.
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
