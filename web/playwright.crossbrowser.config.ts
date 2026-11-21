/**
 * Playwright config for the cross-browser CI job (#9610).
 *
 * firefox, webkit and the two mobile projects were declared in
 * playwright.config.ts for months and executed by nothing: every workflow
 * passed --project=chromium or a chromium-only config, so the cross-browser
 * coverage the default config advertised was a label. This config runs the
 * same @ui selection as playwright.ci.config.ts on the other engines, against
 * the same production server (`next build` + `next start`).
 *
 * There is deliberately NO global `launchOptions`: `--disable-gpu` and
 * `--no-sandbox` are Chromium flags, so passing them to a Firefox or WebKit
 * launch is at best meaningless and at worst a launch failure. Only the
 * Pixel 7 project (a Chromium emulation) carries them. playwright.config.ts
 * set them globally and overrode them per project, which is how its
 * `mobile-iphone` project — an iPhone 14, i.e. WebKit — ended up inheriting
 * them; that project has since been removed there (#9610).
 *
 * Linux WebKit is what Playwright ships and installs (`e2e:install` already
 * pulls it); no macOS runner is involved. The engine's SwiftShader flags are
 * Chromium-only, so WebGPU-on-Safari is out of reach here by design — this is
 * the UI surface, not the canvas.
 *
 * Requires: npx next build run BEFORE playwright (CI workflow handles this).
 * Requires: SKIP_ENV_VALIDATION=true (no Clerk/Stripe keys in CI).
 */
import { defineConfig, devices } from '@playwright/test';
import {
  E2E_NAVIGATION_TIMEOUT_MS,
} from './src/lib/config/timeouts';

const CI_TEST_TIMEOUT_MS = 30_000;
const CI_EXPECT_TIMEOUT_MS = 10_000;

/**
 * The specs that are meaningful at a phone viewport: the compact-layout suite
 * (mobile-responsive, mobile-touch, mobile-viewport), which asserts the drawer
 * layout, the mobile toolbar and WCAG 2.5.5 touch targets.
 *
 * Pinned by the "every per-project testMatch selects at least one spec" block
 * in scripts/__tests__/e2e-tag-routing.test.sh: a glob that matches nothing
 * makes the project run zero tests and report green, which is #9586's shape.
 */
const MOBILE_TEST_MATCH = '**/mobile-*.spec.ts';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: true,
  retries: 1,
  // ci.yml runs ONE project per job (matrix), so a runner hosts a single
  // engine's 385 specs rather than all four's 1540. Two workers on the 4-core
  // ubuntu-latest runner leaves headroom for WebKit, which is the memory-
  // hungriest of the four; raising this is a measured change, not a guess.
  workers: 2,
  // Per-project budget, not a suite-wide one: a browser that is broken outright
  // stops after 20 failures instead of burning the full 30-minute timeout, and
  // because the job is per-project that truncation is attributable to the
  // engine that caused it.
  maxFailures: 20,
  reporter: [['github'], ['html', { open: 'never', outputFolder: 'playwright-report-crossbrowser' }]],
  timeout: CI_TEST_TIMEOUT_MS,
  expect: { timeout: CI_EXPECT_TIMEOUT_MS },

  use: {
    baseURL: 'http://localhost:3000',
    actionTimeout: 10_000,
    navigationTimeout: E2E_NAVIGATION_TIMEOUT_MS,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], launchOptions: { args: [] } },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], launchOptions: { args: [] } },
    },
    // The two mobile projects run MOBILE_TEST_MATCH, not the whole @ui suite.
    //
    // Not a convenience: `getLayoutConfig()` (src/hooks/useResponsiveLayout.ts)
    // returns mode 'compact' with every panel flag false below 1024px, and
    // EditorLayout's compact branch renders no Dockview at all — the hierarchy
    // and inspectors mount inside <DrawerPanel>. iPhone 14 is 390px and Pixel 7
    // is 412px, so `.dv-panel`, the desktop sidebar and the sidebar Settings
    // button DO NOT EXIST at these widths, by design. Pointing the desktop
    // editor specs at them asserts markup the product deliberately does not
    // render; it fails for the layout, never for the engine, which is the only
    // variable these projects exist to vary. First run: both mobile projects
    // failed a byte-identical set while desktop firefox and desktop webkit
    // passed the same specs — same engines on both sides of the split.
    //
    // Nothing is weakened. Every one of those specs still runs on chromium
    // (playwright.ci.config.ts) and on this config's firefox and webkit
    // projects, all at desktop width where their assertions are meaningful.
    //
    // Two of the 21 were NOT layout artefacts: accessibility-audit.spec.ts:73
    // and :157 surfaced real WCAG-critical violations (aria-required-children,
    // unlabelled type="color"/type="range" inputs, select-name). They are
    // invisible on desktop only because buildAxe() excludes '.dv-dockview',
    // which exempts SpawnForge's own inspector markup rather than just
    // Dockview's chrome. Tracked at #9677 — deliberately NOT silenced here.
    {
      name: 'mobile-iphone',
      testMatch: MOBILE_TEST_MATCH,
      use: { ...devices['iPhone 14'], launchOptions: { args: [] } },
    },
    {
      name: 'mobile-pixel',
      testMatch: MOBILE_TEST_MATCH,
      // Pixel 7 is a Chromium emulation, so the Chromium-only flags apply.
      use: { ...devices['Pixel 7'], launchOptions: { args: ['--disable-gpu', '--no-sandbox'] } },
    },
  ],

  webServer: {
    command: 'npx next start',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
