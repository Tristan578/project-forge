import { test, expect } from '@playwright/test';
import {
  E2E_TIMEOUT_LOAD_MS,
  E2E_TIMEOUT_WASM_MS,
} from '../constants';

/**
 * #8603 / #9049: Playing a published game, end-to-end coverage.
 *
 * The published-game player (web/src/components/play/GamePlayer.tsx) fetches
 * GET /api/play/{userId}/{slug} and renders the returned scene. The public page
 * route web/src/app/play/[userId]/[slug]/page.tsx wraps that player.
 *
 * In the CI env (`next start`, SKIP_ENV_VALIDATION=true, no DATABASE_URL /
 * Clerk) there is NO seeded game, so the data route returns 404 (game not found)
 * or 500 (DB unavailable).
 *
 * #9049 changed the PAGE route's own handling of that same missing-game case:
 * it now calls next/navigation notFound() (see page.tsx and the component test
 * web/src/app/play/[userId]/[slug]/__tests__/page.test.tsx, which pins that
 * GamePlayer and Breadcrumbs are never constructed on that path), so the
 * request renders the colocated not-found.tsx boundary instead of GamePlayer's
 * SSR shell. That boundary reproduces the ":(" face, "Game Not Found" heading,
 * and "Back to SpawnForge" link GamePlayer's own client error block shows for a
 * hydrated, found-but-errored game — the two are visually identical by design,
 * but only one of them mounts GamePlayer/Breadcrumbs at all.
 *
 * Coverage is layered deliberately:
 *   - @api (this file): the data route's status + JSON shape for a missing game.
 *   - @ui (this file): that the real page route wires notFound() through to the
 *     not-found.tsx boundary for a missing game (no redirect to sign-in, not
 *     the editor, and neither GamePlayer nor the Community breadcrumb mount).
 *   - GamePlayer's CLIENT error block (the same ":(" presentation, but reached
 *     by a HYDRATED GamePlayer whose own fetch to /api/play fails after the
 *     page found a real, published game) is owned by the component test
 *     web/src/components/play/__tests__/GamePlayer.test.tsx, which mocks fetch
 *     (404 / 500 / throw) and asserts each variant. That is the correct layer
 *     for it: it exercises the found-game path, which needs a seeded DB to
 *     reach at the page level (see @engine below).
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
    // DB-less CI: resolve fails (404) or the DB is down (500), or 429 if the
    // per-IP rate limiter (checked before resolution) trips. Never a 200.
    expect([404, 429, 500]).toContain(response.status());
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
    // The /play/[userId]/[slug] page is a server component; the HTML document
    // itself must always be served (never a raw transport-level failure), even
    // when the game is missing and the response body is the not-found.tsx
    // boundary (#9049 — see the file header for the status-code nuance).
    const response = await request.get(PAGE_PATH, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
  });

  test('renders the not-found boundary for a missing game', async ({ page }) => {
    // #9049: what E2E uniquely verifies here is the PAGE-ROUTE WIRING — that
    // /play/[userId]/[slug] actually reaches next/navigation notFound() (and
    // not a redirect to sign-in, or the editor) for a missing game, which
    // Next renders as the colocated not-found.tsx boundary. notFound() throws
    // before the JSON-LD script, Breadcrumbs, or GamePlayer are ever
    // constructed (pinned at the component layer in
    // web/src/app/play/[userId]/[slug]/__tests__/page.test.tsx), so this
    // boundary and the found-game render are mutually exclusive: asserting
    // one implies the absence of the other.
    await page.goto(PAGE_PATH);
    await page.waitForLoadState('domcontentloaded');

    const notFoundAlert = page.getByRole('alert').filter({ hasText: 'Game Not Found' });
    await expect(notFoundAlert).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });
    await expect(
      notFoundAlert.getByRole('heading', { name: 'Game Not Found' })
    ).toBeVisible();
    await expect(
      notFoundAlert.getByText('This game does not exist or is not currently published.')
    ).toBeVisible();
    await expect(
      notFoundAlert.getByRole('link', { name: 'Back to SpawnForge' })
    ).toBeVisible();
  });

  test('does not mount GamePlayer or the Community breadcrumb for a missing game', async ({ page }) => {
    // Guards the guard: the found-game render (GamePlayer's route mount +
    // the Community breadcrumb — see page.tsx) must NOT appear alongside the
    // not-found boundary above. Both are unconditionally present before
    // #9049 and unconditionally absent after it for this same request.
    await page.goto(PAGE_PATH);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByRole('alert').filter({ hasText: 'Game Not Found' })).toBeVisible({
      timeout: E2E_TIMEOUT_LOAD_MS,
    });
    await expect(page.getByTestId('game-player-route-mount')).toHaveCount(0);
    await expect(page.locator('nav[aria-label="Breadcrumb"]')).toHaveCount(0);
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
