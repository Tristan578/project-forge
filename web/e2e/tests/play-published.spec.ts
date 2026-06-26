import { test, expect } from '@playwright/test';
import {
  E2E_TIMEOUT_LOAD_MS,
  E2E_TIMEOUT_WASM_MS,
} from '../constants';

/**
 * #8603: Playing a published game, end-to-end coverage.
 *
 * The published-game player (web/src/components/play/GamePlayer.tsx) fetches
 * GET /api/play/{userId}/{slug} and renders the returned scene. The public page
 * route web/src/app/play/[userId]/[slug]/page.tsx wraps that player.
 *
 * In the CI env (`next start`, SKIP_ENV_VALIDATION=true, no DATABASE_URL /
 * Clerk) there is NO seeded game, so the data route returns 404 (game not found)
 * or 500 (DB unavailable) and the page route still renders (200).
 *
 * Coverage is layered deliberately:
 *   - @api (this file): the data route's status + JSON shape for a missing game.
 *   - @ui (this file): that the real page route MOUNTS GamePlayer's SSR shell —
 *     200 + the "Loading game..." loading state + the Community breadcrumb —
 *     i.e. the page wiring (no hard 404, no redirect to sign-in, not the editor).
 *   - GamePlayer's CLIENT error block (the ":(" face, the "Game Not Found" /
 *     "Something Went Wrong" heading variants, and the "Back to SpawnForge" link)
 *     is owned by the component test
 *     web/src/components/play/__tests__/GamePlayer.test.tsx, which mocks fetch
 *     (404 / 500 / throw) and asserts each variant. That is the correct layer for
 *     it: the error block only paints AFTER GamePlayer hydrates and its fetch
 *     effect runs. In the DB-less @ui gate the dynamic /play render's RSC stream
 *     does not complete hydration of the interactive subtree (the network trace
 *     shows GamePlayer's /api/play fetch never fires and the page sits on the
 *     SSR'd "Loading game..." shell), so an E2E error-block assertion can never
 *     be deterministic here regardless of route stub or timeout — hence it lives
 *     at the component layer, not here.
 *
 * A true seeded happy path (real published game -> canvas boots -> playable)
 * needs WASM + a seeded DB, so it lives behind @engine and is excluded from the
 * PR/CD gate via `--grep-invert @engine`.
 */

const FAKE_USER = 'user_e2e_nonexistent_8603';
const FAKE_SLUG = 'no-such-game-8603';
const DATA_PATH = `/api/play/${FAKE_USER}/${FAKE_SLUG}`;
const PAGE_PATH = `/play/${FAKE_USER}/${FAKE_SLUG}`;

test.describe('Play Published Game — data route @api', () => {
  test('unknown user/slug returns 404 (or 500 when DB unavailable)', async ({ request }) => {
    const response = await request.get(DATA_PATH, { maxRedirects: 0 });
    // DB-less CI: resolve fails (404) or the DB is down (500). Never a 200.
    expect([404, 500]).toContain(response.status());
    expect(response.status()).not.toBe(200);
  });

  test('responds as JSON, not an HTML error page', async ({ request }) => {
    const response = await request.get(DATA_PATH, { maxRedirects: 0 });
    const contentType = response.headers()['content-type'] ?? '';
    expect(contentType).toContain('application/json');
    const body = await response.json();
    // Error responses carry a string `error`, never a `game` payload.
    expect(body.game).toBeUndefined();
    expect(typeof body.error).toBe('string');
  });

  test('route is wired (not 405 for GET)', async ({ request }) => {
    const response = await request.get(DATA_PATH, { maxRedirects: 0 });
    expect(response.status()).not.toBe(405);
  });
});

test.describe('Play Published Game — public page @ui', () => {
  test('page route exists (not a hard 404 from the server)', async ({ request }) => {
    // The /play/[userId]/[slug] page is a server component that always renders
    // (it defers the missing-game decision to the client GamePlayer), so the
    // HTML document itself must be served with 200.
    const response = await request.get(PAGE_PATH, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
  });

  test('mounts the GamePlayer shell on the real page route', async ({ page }) => {
    // What E2E uniquely verifies here is the PAGE-ROUTE WIRING: that
    // /play/[userId]/[slug] actually mounts GamePlayer (and not a hard 404, a
    // redirect to sign-in, or the editor) for a missing game. GamePlayer's
    // initial render is its loading shell ("Loading game..."), which is part of
    // the SSR output and therefore deterministic in the DB-less @ui gate.
    //
    // The CLIENT error block (":(" face, "Game Not Found" / "Something Went
    // Wrong" heading, "Back to SpawnForge" link) is asserted at the component
    // layer in web/src/components/play/__tests__/GamePlayer.test.tsx — it needs a
    // hydrated, interactive GamePlayer, and the dynamic /play render's RSC stream
    // does not complete that hydration in this gate (the network trace shows the
    // /api/play fetch never fires), so it cannot be driven from here. See the
    // file header for the full layering rationale.
    await page.goto(PAGE_PATH);
    await page.waitForLoadState('domcontentloaded');

    // GamePlayer mounted in its loading state -> the page wired the player.
    await expect(page.getByText('Loading game...')).toBeVisible({
      timeout: E2E_TIMEOUT_LOAD_MS,
    });
  });

  test('Community breadcrumb is present on the play page', async ({ page }) => {
    await page.goto(PAGE_PATH);
    await page.waitForLoadState('domcontentloaded');

    const breadcrumb = page.locator('nav[aria-label="Breadcrumb"]');
    await expect(breadcrumb).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });

    // In the DB-less @ui gate getGameData() returns null, so the only non-Home
    // crumb passed to <Breadcrumbs> is { label: 'Community', href: '/community' }
    // (href is a required BreadcrumbItem field) -> 'Community' is
    // the TERMINAL crumb, rendered as a non-link <span aria-current="page">
    // (a deeper game-title crumb only appears when the DB resolves the game,
    // which never happens here). Assert the current-page span, not a link.
    await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('Community');
    // The prepended 'Home' entry is non-terminal, so it IS a real link.
    await expect(breadcrumb.getByRole('link', { name: 'Home' })).toBeVisible();
  });
});

test.describe('Play Published Game — seeded happy path @engine', () => {
  // EXCLUDED from the PR/CD gate (`--grep-invert @engine`): requires WASM + a
  // seeded published game. The engine only inits AFTER the user clicks the
  // "Click to play" overlay (autoplay policy), and the player canvas is
  // `#play-canvas` (distinct from the editor canvas).
  test('seeded game boots the player canvas after Click to play', async ({ page }) => {
    test.skip(
      !process.env.E2E_SEEDED_PLAY_USER || !process.env.E2E_SEEDED_PLAY_SLUG,
      'Requires a seeded published game (E2E_SEEDED_PLAY_USER / E2E_SEEDED_PLAY_SLUG)'
    );

    const user = process.env.E2E_SEEDED_PLAY_USER as string;
    const slug = process.env.E2E_SEEDED_PLAY_SLUG as string;
    await page.goto(`/play/${user}/${slug}`);
    await page.waitForLoadState('domcontentloaded');

    // The "Click to play" overlay gates engine init under the autoplay policy.
    const playOverlay = page.getByText('Click to play');
    await expect(playOverlay).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });
    await playOverlay.click();

    // After init, the player canvas mounts and the engine settles.
    await expect(page.locator('#play-canvas')).toBeVisible({ timeout: E2E_TIMEOUT_WASM_MS });
  });
});
