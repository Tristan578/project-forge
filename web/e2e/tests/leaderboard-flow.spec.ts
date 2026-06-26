import { test, expect } from '@playwright/test';

/**
 * #8603: Leaderboard submit + view E2E coverage.
 *
 * Exercises GET + POST /api/play/[userId]/[slug]/leaderboard via Playwright's
 * request context (no browser or WASM build needed).
 *
 * The CI env (`next start`, SKIP_ENV_VALIDATION=true, no DATABASE_URL / Clerk)
 * has NO seeded DB, so DB-backed reads return 404 (game not found) OR 500 (DB
 * unavailable) — assertions tolerate both and never assert a 200 happy path.
 *
 * The POST validation branches (invalid JSON, missing name, missing/over-long
 * playerName, non-finite score) all run BEFORE resolvePublishedGame, so they
 * are deterministic in CI regardless of DB state. They are the load-bearing
 * regression coverage: a broken validation branch turns this spec red instead
 * of shipping silently.
 *
 * A true seeded submit+read-back happy path requires a published game + a
 * leaderboard row, so it is deferred to an @engine follow-up (excluded from the
 * PR/CD gate via `--grep-invert @engine`).
 */

// A user/slug pair that cannot exist in a fresh CI DB.
const FAKE_USER = 'user_e2e_nonexistent_8603';
const FAKE_SLUG = 'no-such-game-8603';
const LEADERBOARD_PATH = `/api/play/${FAKE_USER}/${FAKE_SLUG}/leaderboard`;

test.describe('Leaderboard API @api', () => {
  // -------------------------------------------------------------------------
  // GET — fetch scores
  // -------------------------------------------------------------------------
  test.describe('GET leaderboard', () => {
    test('unknown game returns 404 (or 500 when DB unavailable)', async ({ request }) => {
      const response = await request.get(LEADERBOARD_PATH, { maxRedirects: 0 });
      // No seeded game in CI -> resolvePublishedGame returns null (404), or the
      // DB itself is unavailable (500), or 429 if the per-IP rate limiter (checked
      // before game resolution) trips. Never a 200 with real data.
      expect([404, 429, 500]).toContain(response.status());
      expect(response.status()).not.toBe(200);
    });

    test('responds as JSON, not an HTML error page', async ({ request }) => {
      const response = await request.get(LEADERBOARD_PATH, { maxRedirects: 0 });
      const contentType = response.headers()['content-type'] ?? '';
      expect(contentType).toContain('application/json');
    });

    test('endpoint exists (route is wired, not 405)', async ({ request }) => {
      const response = await request.get(LEADERBOARD_PATH, { maxRedirects: 0 });
      // GET is a supported method on this route.
      expect(response.status()).not.toBe(405);
    });
  });

  // -------------------------------------------------------------------------
  // POST — submit a score. Validation precedes DB access, so these are
  // deterministic in CI.
  // -------------------------------------------------------------------------
  test.describe('POST score validation', () => {
    test('invalid JSON body returns 400 "Invalid JSON body"', async ({ request }) => {
      const response = await request.post(LEADERBOARD_PATH, {
        headers: { 'content-type': 'application/json' },
        data: 'this-is-not-json{',
        maxRedirects: 0,
      });
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Invalid JSON body');
    });

    test('missing name field returns 400', async ({ request }) => {
      const response = await request.post(LEADERBOARD_PATH, {
        data: { playerName: 'Ada', score: 100 },
        maxRedirects: 0,
      });
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('name');
    });

    test('missing playerName returns 400', async ({ request }) => {
      const response = await request.post(LEADERBOARD_PATH, {
        data: { name: 'default', score: 100 },
        maxRedirects: 0,
      });
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('playerName');
    });

    test('over-long playerName (>64 chars) returns 400', async ({ request }) => {
      const response = await request.post(LEADERBOARD_PATH, {
        data: { name: 'default', playerName: 'a'.repeat(65), score: 100 },
        maxRedirects: 0,
      });
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('playerName');
    });

    test('non-finite score returns 400', async ({ request }) => {
      // JSON cannot carry Infinity/NaN, so a non-number score value exercises
      // the same "score must be a finite number" branch (typeof !== 'number').
      const response = await request.post(LEADERBOARD_PATH, {
        data: { name: 'default', playerName: 'Ada', score: 'not-a-number' },
        maxRedirects: 0,
      });
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('score');
    });

    test('missing score returns 400', async ({ request }) => {
      const response = await request.post(LEADERBOARD_PATH, {
        data: { name: 'default', playerName: 'Ada' },
        maxRedirects: 0,
      });
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('score');
    });
  });

  // -------------------------------------------------------------------------
  // POST — well-formed body against an unknown game. Validation passes, then
  // resolvePublishedGame returns null (404) or the DB is unavailable (500).
  // -------------------------------------------------------------------------
  test.describe('POST against unknown game', () => {
    test('well-formed submission to unknown game returns 404 (or 500)', async ({ request }) => {
      const response = await request.post(LEADERBOARD_PATH, {
        data: { name: 'default', playerName: 'Ada', score: 100 },
        maxRedirects: 0,
      });
      // Validation passed; game lookup fails -> 404, or DB down -> 500, or 429 if
      // the per-IP rate limiter (checked first) trips. Never a 201 created in a
      // DB-less CI env.
      expect([404, 429, 500]).toContain(response.status());
      expect(response.status()).not.toBe(201);
    });
  });
});
