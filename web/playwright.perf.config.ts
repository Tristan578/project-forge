/**
 * Playwright config for the LOCAL exported-fixture performance capture
 * (#9904 / #10013, operation performance.FR-3.OP-01).
 *
 *   cd web && npx playwright test --config=playwright.perf.config.ts
 *
 * Selects only `@perf-gpu` in `e2e/perf/`. No CI job uses this config: CI
 * runners have no GPU, and the capture needs the runtime engine packages in
 * `public/engine-pkg-*-runtime/` built locally. See
 * `docs/guides/performance-fixture-capture.md` for the environment knobs and
 * how the evidence is read.
 *
 * Browser: the installed Google Chrome (`channel: 'chrome'`), not Playwright's
 * bundled Chromium. Measured on Windows: the bundled build could not create a
 * WebGPU device (Dawn failed to load dxil.dll), while Chrome ran the WebGPU
 * runtime on the real GPU. Background throttling is disabled so an occluded
 * window does not slow animation frames; the harness still records a hidden
 * page and refuses to pass a budget from it.
 *
 * One worker, no retries: runs are sequential so they do not share the GPU,
 * and a failed run must stay failed in the evidence.
 */
import { defineConfig } from '@playwright/test';

// Tells e2e/perf/fixtureCapture.spec.ts it was selected on purpose. Any other
// config that happens to match the spec file skips it with the reason stated.
process.env.FORGE_PERF_CAPTURE_CONFIG = '1';

const gpuArgs = [
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  '--enable-unsafe-webgpu',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []),
  // Uncapped frames by default (PERF_VSYNC=1 to pace to the display instead).
  // With vsync on, a frame interval can never be shorter than the refresh
  // period, so on a 60 Hz display a perfectly smooth run already sits at the
  // 16.7 ms budget and jitter decides the verdict. Uncapped, the interval is
  // the time the page actually needed per frame, which is what a 60 fps budget
  // is asking about.
  ...(process.env.PERF_VSYNC === '1' ? [] : ['--disable-gpu-vsync', '--disable-frame-rate-limit']),
];

export default defineConfig({
  testDir: './e2e/perf',
  testMatch: '**/*.spec.ts',
  grep: /@perf-gpu/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [['list']],
  use: {
    // PERF_CHANNEL=msedge captures in Edge: a second exact browser version on
    // the same machine, for the incompatible-baseline check.
    channel: process.env.PERF_CHANNEL || 'chrome',
    headless: process.env.PERF_HEADED !== '1',
    launchOptions: { args: gpuArgs },
    trace: 'off',
    video: 'off',
  },
});
