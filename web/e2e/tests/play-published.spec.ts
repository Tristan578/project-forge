import { test, expect } from '@playwright/test';
import {
  E2E_TIMEOUT_LOAD_MS,
  E2E_TIMEOUT_WASM_MS,
} from '../constants';

/**
 * DB-less PR gates verify exact temporary-failure503 documents. Missing published
 * data is separately covered through actual proxy/Neon/Drizzle transport fixtures
 * and database-backed browser cases; the seeded player stays in its engine suite.
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

test.describe('Play Published Game — DB-less public page @ui', () => {
  test('database-unavailable page returns literal HTTP503 before any response streaming', async ({ request }) => {
    const response = await request.get(PAGE_PATH, { maxRedirects: 0 });
    expect(response.status()).toBe(503);
    expect(response.headers()['content-type']).toContain('text/html');
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(response.headers()['x-robots-tag']).toBeUndefined();
    expect(response.headers()['retry-after']).toBe('60');
    const html = await response.text();
    expect(html).toContain('<title>Game Temporarily Unavailable - SpawnForge</title>');
    expect(html).not.toContain('VideoGame');
    expect(html).not.toContain('noindex');
  });

  test('renders the actual temporary-failure alert and reachable home link', async ({ page }) => {
    const response = await page.goto(PAGE_PATH);
    expect(response?.status()).toBe(503);
    const alert = page.getByRole('alert');
    await expect(alert.getByRole('heading', { name: 'Game Temporarily Unavailable' })).toBeVisible({
      timeout: E2E_TIMEOUT_LOAD_MS,
    });
    await expect(alert).toContainText('Please try again shortly.');
    const home = alert.getByRole('link', { name: 'Back to SpawnForge' });
    await expect(home).toHaveAttribute('href', '/');
    await page.keyboard.press('Tab');
    await expect(home).toBeFocused();
    await expect(page.getByTestId('game-player-route-mount')).toHaveCount(0);
    await expect(page.locator('nav[aria-label="Breadcrumb"]')).toHaveCount(0);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  });

  test('HEAD and crawler requests also receive503 without a player document', async ({ request }) => {
    const head = await request.head(PAGE_PATH, { maxRedirects: 0 });
    expect(head.status()).toBe(503);
    expect(await head.body()).toHaveLength(0);
    const bot = await request.get(PAGE_PATH, { maxRedirects: 0, headers: { 'user-agent': 'Twitterbot' } });
    expect(bot.status()).toBe(503);
    expect(await bot.text()).toContain('Game Temporarily Unavailable');
  });
});

test.describe('Play Published Game — database-backed absence @api', () => {
  test.beforeEach(() => {
    test.skip(!process.env.DATABASE_URL, 'Requires an available database; DB-less gates assert exact503 separately');
  });

  test('an absent author has literal404 for GET, HEAD and crawlers', async ({ request }) => {
    const response = await request.get(PAGE_PATH, { maxRedirects: 0 });
    expect(response.status()).toBe(404);
    expect(response.headers()['x-robots-tag']).toBe('noindex');
    expect(await response.text()).toContain('<h1>Game Not Found</h1>');
    const head = await request.head(PAGE_PATH, { maxRedirects: 0 });
    expect(head.status()).toBe(404);
    expect(await head.body()).toHaveLength(0);
    const crawler = await request.get(PAGE_PATH, { maxRedirects: 0, headers: { 'user-agent': 'Twitterbot' } });
    expect(crawler.status()).toBe(404);
    expect(await crawler.text()).not.toContain('VideoGame');
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
