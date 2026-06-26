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
 * Clerk) there is NO seeded game, so:
 *   - the data route returns 404 (game not found) or 500 (DB unavailable);
 *   - the page route still renders (200) and the client GamePlayer paints its
 *     error state once the fetch fails. The gates run DB-less (no DATABASE_URL),
 *     so getDb() throws and the route 500s -> the player shows the "Something
 *     Went Wrong" heading variant (the 404 path shows "Game Not Found"). The
 *     @ui assertion targets the elements common to both variants (the ":(" face
 *     and the "Back to SpawnForge" link) so it is robust to either failure mode.
 *
 * The gate-running coverage (@api + @ui) asserts those deterministic contracts.
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

  test('renders the player error state for a missing game', async ({ page }) => {
    await page.goto(PAGE_PATH);
    await page.waitForLoadState('domcontentloaded');

    // GamePlayer fetches the data route and paints its error block. The exact
    // heading depends on WHY the fetch failed, and that differs by env:
    //   - 404 (game not found / unpublished) -> heading "Game Not Found"
    //   - 500 (DB unavailable, e.g. the DB-less @ui gate where getDb() throws)
    //     -> heading "Something Went Wrong"
    // Both gates (ci.yml test-e2e-ui @ui shard, cd.yml e2e) run with NO
    // DATABASE_URL, so the 500 variant is what actually renders here. Assert on
    // the elements the error block renders IDENTICALLY in either case: the ":("
    // face and the "Back to SpawnForge" recovery link. This still proves the
    // error state painted (not the loading spinner, not the game chrome) while
    // staying deterministic across both failure modes.
    await expect(page.getByText(':(', { exact: true })).toBeVisible({
      timeout: E2E_TIMEOUT_LOAD_MS,
    });

    // The error state offers a way back to SpawnForge.
    await expect(page.getByRole('link', { name: /Back to SpawnForge/i })).toBeVisible();
  });

  test('Community breadcrumb is present on the play page', async ({ page }) => {
    await page.goto(PAGE_PATH);
    await page.waitForLoadState('domcontentloaded');

    const breadcrumb = page.locator('nav[aria-label="Breadcrumb"]');
    await expect(breadcrumb).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });

    // In the DB-less @ui gate getGameData() returns null, so the only non-Home
    // crumb passed to <Breadcrumbs> is { label: 'Community' } -> 'Community' is
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
