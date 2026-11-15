/**
 * Unit tests for the leaderboard channel handler (leaderboardChannel.ts).
 *
 * Tests cover: submit success, getTop success, argument forwarding, the
 * missing-published-identity rejection, unknown methods, and the not-found /
 * error path surfacing as a rejected promise.
 */

import { describe, it, expect, vi } from 'vitest';
import { createLeaderboardHandler } from '../leaderboardChannel';

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

const noProgress = vi.fn();

/** Extract the RequestInit from the second argument of a vi.fn() call. */
function getCallInit(mockFn: ReturnType<typeof vi.fn>, callIndex = 0): RequestInit {
  return (mockFn.mock.calls[callIndex] as [string, RequestInit])[1];
}

function getCallUrl(mockFn: ReturnType<typeof vi.fn>, callIndex = 0): string {
  return (mockFn.mock.calls[callIndex] as [string, RequestInit])[0];
}

describe('createLeaderboardHandler', () => {
  describe('submit', () => {
    it('POSTs to the published-game leaderboard route and returns the rank', async () => {
      const fetchJson = vi.fn(() => Promise.resolve({ success: true, rank: 3, entry: {} }));
      const handler = createLeaderboardHandler({ fetchJson, userId: 'user_abc', slug: 'my-game' });

      const result = await handler(
        'submit',
        { name: 'high-scores', playerName: 'Ada', score: 4200, metadata: { level: 7 } },
        noProgress,
        makeSignal(),
      );

      expect(getCallUrl(fetchJson)).toBe('/api/play/user_abc/my-game/leaderboard');
      expect(getCallInit(fetchJson)).toMatchObject({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = JSON.parse(getCallInit(fetchJson).body as string);
      expect(body).toEqual({
        name: 'high-scores',
        playerName: 'Ada',
        score: 4200,
        metadata: { level: 7 },
      });
      expect(result).toEqual({ rank: 3 });
    });

    it('returns null when the response carries no numeric rank', async () => {
      const fetchJson = vi.fn(() => Promise.resolve({ success: true }));
      const handler = createLeaderboardHandler({ fetchJson, userId: 'u', slug: 's' });

      const result = await handler('submit', { name: 'b', playerName: 'p', score: 1 }, noProgress, makeSignal());
      expect(result).toBeNull();
    });

    it('percent-encodes userId and slug in the route', async () => {
      const fetchJson = vi.fn(() => Promise.resolve({ rank: 1 }));
      const handler = createLeaderboardHandler({ fetchJson, userId: 'user id', slug: 'a/b' });

      await handler('submit', { name: 'b', playerName: 'p', score: 1 }, noProgress, makeSignal());
      expect(getCallUrl(fetchJson)).toBe('/api/play/user%20id/a%2Fb/leaderboard');
    });
  });

  describe('getTop', () => {
    it('GETs the route with name and limit query params and returns entries', async () => {
      const entries = [
        { rank: 1, playerName: 'Ada', score: 9000, metadata: null, createdAt: '2026-09-14T00:00:00.000Z' },
      ];
      const fetchJson = vi.fn(() => Promise.resolve({ leaderboard: { name: 'hs' }, entries }));
      const handler = createLeaderboardHandler({ fetchJson, userId: 'u', slug: 's' });

      const result = await handler('getTop', { name: 'hs', limit: 5 }, noProgress, makeSignal());

      expect(getCallUrl(fetchJson)).toBe('/api/play/u/s/leaderboard?name=hs&limit=5');
      expect(result).toEqual(entries);
    });

    it('omits the query string when no name or limit is supplied', async () => {
      const fetchJson = vi.fn(() => Promise.resolve({ entries: [] }));
      const handler = createLeaderboardHandler({ fetchJson, userId: 'u', slug: 's' });

      const result = await handler('getTop', {}, noProgress, makeSignal());
      expect(getCallUrl(fetchJson)).toBe('/api/play/u/s/leaderboard');
      expect(result).toEqual([]);
    });

    it('returns null when the response carries no entries array', async () => {
      const fetchJson = vi.fn(() => Promise.resolve({ leaderboard: { name: 'hs' } }));
      const handler = createLeaderboardHandler({ fetchJson, userId: 'u', slug: 's' });

      const result = await handler('getTop', { name: 'hs' }, noProgress, makeSignal());
      expect(result).toBeNull();
    });
  });

  describe('missing published identity', () => {
    it('rejects submit without calling fetchJson when userId is null', async () => {
      const fetchJson = vi.fn();
      const handler = createLeaderboardHandler({ fetchJson, userId: null, slug: 's' });

      await expect(
        handler('submit', { name: 'b', playerName: 'p', score: 1 }, noProgress, makeSignal()),
      ).rejects.toThrow('only available when playing a published game');
      expect(fetchJson).not.toHaveBeenCalled();
    });

    it('rejects getTop without calling fetchJson when slug is null', async () => {
      const fetchJson = vi.fn();
      const handler = createLeaderboardHandler({ fetchJson, userId: 'u', slug: null });

      await expect(
        handler('getTop', { name: 'b' }, noProgress, makeSignal()),
      ).rejects.toThrow('only available when playing a published game');
      expect(fetchJson).not.toHaveBeenCalled();
    });
  });

  describe('error paths', () => {
    it('surfaces a not-found (404) submit as a rejected promise', async () => {
      const fetchJson = vi.fn(() => Promise.reject(new Error('HTTP 404: Not Found')));
      const handler = createLeaderboardHandler({ fetchJson, userId: 'u', slug: 's' });

      await expect(
        handler('submit', { name: 'b', playerName: 'p', score: 1 }, noProgress, makeSignal()),
      ).rejects.toThrow('HTTP 404');
    });

    it('surfaces a not-found (404) getTop as a rejected promise', async () => {
      const fetchJson = vi.fn(() => Promise.reject(new Error('HTTP 404: Not Found')));
      const handler = createLeaderboardHandler({ fetchJson, userId: 'u', slug: 's' });

      await expect(
        handler('getTop', { name: 'missing-board' }, noProgress, makeSignal()),
      ).rejects.toThrow('HTTP 404');
    });

    it('throws for an unknown method', async () => {
      const fetchJson = vi.fn(() => Promise.resolve({}));
      const handler = createLeaderboardHandler({ fetchJson, userId: 'u', slug: 's' });

      await expect(
        handler('reset', {}, noProgress, makeSignal()),
      ).rejects.toThrow('Unknown leaderboard method: reset');
      expect(fetchJson).not.toHaveBeenCalled();
    });
  });
});
