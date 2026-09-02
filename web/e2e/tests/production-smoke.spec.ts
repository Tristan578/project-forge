/**
 * Production smoke tests — verify the LIVE site works.
 *
 * These tests run against the actual production URL (PRODUCTION_URL env var
 * or https://www.spawnforge.ai by default). They verify critical user journeys
 * that CI localhost tests cannot catch:
 *
 * - Public pages load (not 404, not redirect loop)
 * - Clerk auth keys are production-grade (not pk_test_)
 * - WASM engine files are accessible on CDN
 * - Protected routes don't 404 or 500 (Clerk v7 handles auth client-side)
 * - Auth flow routes render correctly
 *
 * Run manually: PRODUCTION_URL=https://www.spawnforge.ai npx playwright test --config playwright.smoke.config.ts
 * Run in CD: triggered as post-deploy step in cd.yml via playwright.smoke.config.ts
 *
 * @tags @smoke @production
 */
import { test, expect, type APIRequestContext } from '@playwright/test';

const PROD_URL = process.env.PRODUCTION_URL || 'https://www.spawnforge.ai';

/**
 * Rolling Releases serve two builds behind the public domain at once. With
 * SMOKE_FORCE_CANARY=true every request is pinned to the canary — the build CD
 * just made — via Vercel's documented `vcrrForceCanary` query parameter, which
 * answers with the `_vcrr_*` cookie; the cookie is carried into both the API
 * request context and the browser context so all later requests stay pinned.
 * Without this, the suite exercised whichever build the 95% base bucket served,
 * i.e. the PREVIOUS deploy (#9624).
 */
const FORCE_CANARY = process.env.SMOKE_FORCE_CANARY === 'true';
/** First 8 chars of the commit /api/health must report; CD passes github.sha. */
const EXPECT_COMMIT = (process.env.SMOKE_EXPECT_COMMIT || '').slice(0, 8);

/** Cookies from the canary seed, added to the one browser context that needs them. */
let canaryCookies: Awaited<ReturnType<APIRequestContext['storageState']>>['cookies'] = [];

// Only the `request` fixture here: asking for `page` would launch a browser
// for every request-only test. The single browser test adds the cookies to
// its own context below.
test.beforeEach(async ({ request }) => {
  canaryCookies = [];
  if (!FORCE_CANARY) return;
  const seed = await request.get(`${PROD_URL}/api/health?vcrrForceCanary=true`);
  expect(seed.status(), 'canary seed request must succeed').toBe(200);
  const { cookies } = await request.storageState();
  if (!cookies.some((c) => c.name.startsWith('_vcrr_'))) {
    // CD set SMOKE_FORCE_CANARY because ensure-canary saw an ACTIVE rollout
    // minutes ago; it can have resolved since (auto-advanced to 100%,
    // completed or aborted by hand, or superseded by a later merge), and
    // Vercel then sets no cookie. The cookie was only ever the vehicle — the
    // commit assertion below is the proof — so let that decide.
    console.warn('SMOKE_FORCE_CANARY is set but Vercel set no _vcrr_ cookie: no rollout is active; the commit assertion decides');
  }
  canaryCookies = cookies;
});

test.describe('Deployment identity @smoke @production', () => {
  test('health endpoint reports the commit this run deployed', async ({ request }) => {
    test.skip(!EXPECT_COMMIT, 'SMOKE_EXPECT_COMMIT is only set by CD; a manual run has no expected commit');
    const res = await request.get(`${PROD_URL}/api/health`);
    expect(res.status()).toBe(200);
    const data = (await res.json()) as { commit?: string };
    // Anything else means the suite is grading a different build than the one
    // this run deployed — the base, or a newer canary.
    expect((data.commit ?? '').slice(0, 8), `health reports ${data.commit}, expected ${EXPECT_COMMIT}`).toBe(EXPECT_COMMIT);
  });
});

test.describe('Production Smoke Tests @smoke @production', () => {
  test('landing page loads with 200', async ({ request }) => {
    const res = await request.get(PROD_URL);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('SpawnForge');
  });

  test('pricing page loads', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/pricing`);
    expect(res.status()).toBe(200);
  });

  test('sign-in page loads', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/sign-in`);
    expect(res.status()).toBe(200);
  });

  /**
   * Regression test for SRI blank-page bug (PR #7985).
   * Vercel CDN post-processes JS chunks, invalidating build-time sha256 hashes.
   * This caused /sign-in to render blank because all client JS was blocked.
   * Uses a real browser (not request.get) to catch SRI integrity failures.
   */
  test('sign-in page renders content (not blank)', async ({ page }) => {
    const integrityErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().match(/integrity|Failed to find a valid digest/i)) {
        integrityErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      if (err.message.match(/integrity|digest/i)) {
        integrityErrors.push(err.message);
      }
    });

    if (canaryCookies.length > 0) await page.context().addCookies(canaryCookies);
    await page.goto(`${PROD_URL}/sign-in`, { waitUntil: 'networkidle' });

    // Page must not be blank — body must have visible content
    const bodyText = await page.evaluate(() => document.body.innerText.trim());
    expect(bodyText.length).toBeGreaterThan(0);

    // No SRI integrity mismatch errors in console
    expect(integrityErrors).toEqual([]);
  });

  test('community page loads', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/community`);
    expect(res.status()).toBe(200);
  });

  test('/dev redirects unauthenticated users to sign-in (not 404)', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/dev`, { maxRedirects: 0 });
    // proxy.ts uses redirectToSignIn() for protected routes (#8529).
    // 307 with a Location pointing at the sign-in page is the only correct
    // response for a signed-out browser visit. 404 = Clerk's protect-rewrite
    // default has regressed (poor UX, no recovery path). 500 = SSR crash.
    expect([307, 302]).toContain(res.status());
    const location = res.headers()['location'] || '';
    expect(location).toMatch(/sign-in/);
  });

  test('no Clerk test keys in production HTML', async ({ request }) => {
    const res = await request.get(PROD_URL);
    const html = await res.text();
    // pk_test_ keys cause auth failures for all visitors
    expect(html).not.toContain('pk_test_');
  });

  test('WASM engine JS is accessible on CDN', async ({ request }) => {
    const cdnUrl = process.env.ENGINE_CDN_URL || 'https://engine.spawnforge.ai';
    const res = await request.get(`${cdnUrl}/engine-pkg-webgl2/forge_engine.js`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain('handle_command');
  });

  test('WASM binary is accessible on CDN', async ({ request }) => {
    const cdnUrl = process.env.ENGINE_CDN_URL || 'https://engine.spawnforge.ai';
    const res = await request.get(`${cdnUrl}/engine-pkg-webgl2/forge_engine_bg.wasm`);
    expect(res.status()).toBe(200);
    // WASM files should be > 1MB
    const body = await res.body();
    expect(body.length).toBeGreaterThan(1_000_000);
  });

  test('API health endpoint responds', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/health`);
    // Health endpoint should return 200 with JSON
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('status');
  });
});

test.describe('Production Auth Flow @smoke @production', () => {
  // Protected routes must redirect unauthenticated browser visitors to /sign-in,
  // not rewrite to /404. Clerk's `auth.protect()` default is protect-rewrite-to-404
  // (route enumeration mitigation), which gives users no recovery path. proxy.ts
  // calls `redirectToSignIn()` instead — see #8529.
  for (const path of ['/dashboard', '/settings']) {
    test(`unauthenticated ${path} redirects to sign-in`, async ({ request }) => {
      const res = await request.get(`${PROD_URL}${path}`, { maxRedirects: 0 });
      const status = res.status();
      expect(
        status === 307 || status === 302,
        `Expected 307/302 redirect but got ${status}. 404 = Clerk protect-rewrite regression. 500 = SSR crash.`,
      ).toBe(true);
      const location = res.headers()['location'] || '';
      expect(location, `Location header should point at sign-in: ${location}`).toMatch(/sign-in/);
    });
  }
});
