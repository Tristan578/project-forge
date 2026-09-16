import { test, expect } from '@playwright/test';
import {
  E2E_TIMEOUT_LOAD_MS,
  E2E_TIMEOUT_WASM_MS,
} from '../constants';

/**
 * Published-game data errors and missing-page documents in DB-less PR gates.
 * The server checks published metadata before streaming and returns a direct404
 * document. These @ui tests pin wire status, real error presentation, and absence
 * of player/VideoGame metadata. Published rendering is also guarded by page unit
 * tests; the seeded playable canvas remains in the existing @engine suite.
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
  test('missing page returns literal HTTP404 before any response streaming', async ({ request }) => {
    const response = await request.get(PAGE_PATH, { maxRedirects: 0 });
    expect(response.status()).toBe(404);
    expect(response.headers()['content-type']).toContain('text/html');
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(response.headers()['x-robots-tag']).toBe('noindex');
    const html = await response.text();
    expect(html).toContain('<title>Game Not Found - SpawnForge</title>');
    expect(html).not.toContain('VideoGame');
  });

  test('renders the actual missing-game alert and reachable home link', async ({ page }) => {
    const response = await page.goto(PAGE_PATH);
    expect(response?.status()).toBe(404);
    const alert = page.getByRole('alert');
    await expect(alert.getByRole('heading', { name: 'Game Not Found' })).toBeVisible({
      timeout: E2E_TIMEOUT_LOAD_MS,
    });
    await expect(alert).toContainText('This game is unavailable right now. It may be missing, unpublished, or temporarily unreachable.');
    const home = alert.getByRole('link', { name: 'Back to SpawnForge' });
    await expect(home).toHaveAttribute('href', '/');
    await page.keyboard.press('Tab');
    await expect(home).toBeFocused();
    await expect(page.getByTestId('game-player-route-mount')).toHaveCount(0);
    await expect(page.locator('nav[aria-label="Breadcrumb"]')).toHaveCount(0);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  });

  test('HEAD and crawler requests also receive404 without a player document', async ({ request }) => {
    const head = await request.head(PAGE_PATH, { maxRedirects: 0 });
    expect(head.status()).toBe(404);
    expect(await head.body()).toHaveLength(0);
    const bot = await request.get(PAGE_PATH, { maxRedirects: 0, headers: { 'user-agent': 'Twitterbot' } });
    expect(bot.status()).toBe(404);
    expect(await bot.text()).toContain('Game Not Found');
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
