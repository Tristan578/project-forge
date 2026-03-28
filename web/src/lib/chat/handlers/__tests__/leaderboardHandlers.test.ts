/**
 * Tests for leaderboardHandlers — create, list, configure, delete leaderboards.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { leaderboardHandlers } from '../leaderboardHandlers';
import { createMockStore } from './handlerTestUtils';

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();

beforeAll(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeCtx() {
  return {
    store: createMockStore(),
    dispatchCommand: vi.fn(),
  };
}

function mockOk(body: Record<string, unknown> = {}) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(body),
  });
}

function mockFail(status: number, error = 'Internal error') {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: () => Promise.resolve({ error }),
  });
}

// ---------------------------------------------------------------------------
// create_leaderboard
// ---------------------------------------------------------------------------
describe('leaderboardHandlers', () => {
  describe('create_leaderboard', () => {
    it('returns error when gameId is missing', async () => {
      const result = await leaderboardHandlers['create_leaderboard'](
        { name: 'High Scores' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('returns error when name is missing', async () => {
      const result = await leaderboardHandlers['create_leaderboard'](
        { gameId: 'game-1' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('posts to the correct URL with defaults', async () => {
      mockOk();
      const result = await leaderboardHandlers['create_leaderboard'](
        { gameId: 'game-1', name: 'High Scores' },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/publish/game-1/leaderboards',
        expect.objectContaining({ method: 'POST' }),
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.sortOrder).toBe('desc');
      expect(result.message).toContain('High Scores');
      expect(result.message).toContain('game-1');
    });

    it('posts with explicit sortOrder and maxEntries', async () => {
      mockOk();
      await leaderboardHandlers['create_leaderboard'](
        { gameId: 'game-2', name: 'Top Players', sortOrder: 'asc', maxEntries: 100 },
        makeCtx(),
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.sortOrder).toBe('asc');
      expect(body.maxEntries).toBe(100);
    });

    it('encodes gameId in the URL', async () => {
      mockOk();
      await leaderboardHandlers['create_leaderboard'](
        { gameId: 'my game/1', name: 'Scores' },
        makeCtx(),
      );
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('my%20game%2F1');
    });

    it('returns error when HTTP request fails', async () => {
      mockFail(500, 'Database unavailable');
      const result = await leaderboardHandlers['create_leaderboard'](
        { gameId: 'game-1', name: 'Scores' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Database unavailable');
    });

    it('returns HTTP status in error when response body has no error field', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({}),
      });
      const result = await leaderboardHandlers['create_leaderboard'](
        { gameId: 'game-1', name: 'Scores' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 403');
    });
  });

  // ---------------------------------------------------------------------------
  // list_leaderboards
  // ---------------------------------------------------------------------------
  describe('list_leaderboards', () => {
    it('returns error when gameId is missing', async () => {
      const result = await leaderboardHandlers['list_leaderboards']({}, makeCtx());
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('GETs leaderboards from the correct URL', async () => {
      mockOk({ leaderboards: [{ name: 'High Scores' }, { name: 'Weekly' }] });
      const result = await leaderboardHandlers['list_leaderboards'](
        { gameId: 'game-1' },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('/api/publish/game-1/leaderboards');
      expect(result.message).toContain('2');
      expect((result.result as Record<string, unknown>).leaderboards).toHaveLength(2);
    });

    it('returns HTTP error on failed request', async () => {
      mockFail(404, 'Game not found');
      const result = await leaderboardHandlers['list_leaderboards'](
        { gameId: 'missing-game' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Game not found');
    });
  });

  // ---------------------------------------------------------------------------
  // configure_leaderboard
  // ---------------------------------------------------------------------------
  describe('configure_leaderboard', () => {
    it('returns error when gameId is missing', async () => {
      const result = await leaderboardHandlers['configure_leaderboard'](
        { name: 'High Scores', sortOrder: 'asc' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('returns error when name is missing', async () => {
      const result = await leaderboardHandlers['configure_leaderboard'](
        { gameId: 'game-1', sortOrder: 'asc' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('PATCHes the leaderboard URL with updated fields', async () => {
      mockOk();
      const result = await leaderboardHandlers['configure_leaderboard'](
        { gameId: 'game-1', name: 'High Scores', sortOrder: 'asc', maxEntries: 50 },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/publish/game-1/leaderboards/High%20Scores',
        expect.objectContaining({ method: 'PATCH' }),
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.sortOrder).toBe('asc');
      expect(body.maxEntries).toBe(50);
      expect(result.message).toContain('High Scores');
      expect(result.message).toContain('game-1');
    });

    it('supports null minScore and maxScore to clear limits', async () => {
      mockOk();
      await leaderboardHandlers['configure_leaderboard'](
        { gameId: 'game-1', name: 'Scores', minScore: null, maxScore: null },
        makeCtx(),
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.minScore).toBeNull();
      expect(body.maxScore).toBeNull();
    });

    it('returns error when HTTP request fails', async () => {
      mockFail(500, 'Update failed');
      const result = await leaderboardHandlers['configure_leaderboard'](
        { gameId: 'game-1', name: 'Scores' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Update failed');
    });
  });

  // ---------------------------------------------------------------------------
  // delete_leaderboard
  // ---------------------------------------------------------------------------
  describe('delete_leaderboard', () => {
    it('returns error when gameId is missing', async () => {
      const result = await leaderboardHandlers['delete_leaderboard'](
        { name: 'High Scores' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('returns error when name is missing', async () => {
      const result = await leaderboardHandlers['delete_leaderboard'](
        { gameId: 'game-1' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('DELETEs the leaderboard at the correct URL', async () => {
      mockOk();
      const result = await leaderboardHandlers['delete_leaderboard'](
        { gameId: 'game-1', name: 'High Scores' },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/publish/game-1/leaderboards/High%20Scores',
        expect.objectContaining({ method: 'DELETE' }),
      );
      expect(result.message).toContain('High Scores');
      expect(result.message).toContain('game-1');
    });

    it('encodes leaderboard name with special characters in URL', async () => {
      mockOk();
      await leaderboardHandlers['delete_leaderboard'](
        { gameId: 'game-1', name: 'Top/Players 2024' },
        makeCtx(),
      );
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('Top%2FPlayers%202024');
    });

    it('returns error when HTTP request fails', async () => {
      mockFail(404, 'Leaderboard not found');
      const result = await leaderboardHandlers['delete_leaderboard'](
        { gameId: 'game-1', name: 'Missing' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Leaderboard not found');
    });

    it('returns HTTP status in error when response body has no error field', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      });
      const result = await leaderboardHandlers['delete_leaderboard'](
        { gameId: 'game-1', name: 'Scores' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 401');
    });
  });
});
