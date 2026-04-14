vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { leaderboardHandlers } from '../leaderboardHandlers';
import type { ToolCallContext } from '../types';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeCtx(): ToolCallContext {
  return { store: {} as never, dispatchCommand: vi.fn() } as unknown as ToolCallContext;
}

describe('leaderboardHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create_leaderboard', () => {
    it('creates a leaderboard with required fields', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
      const result = await leaderboardHandlers.create_leaderboard(
        { gameId: 'game_1', name: 'High Scores' },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain('High Scores');
      expect(result.message).toContain('game_1');
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/publish/game_1/leaderboards',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('uses default sortOrder desc', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
      await leaderboardHandlers.create_leaderboard(
        { gameId: 'g1', name: 'Scores' },
        makeCtx(),
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.sortOrder).toBe('desc');
    });

    it('passes sortOrder asc when specified', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
      await leaderboardHandlers.create_leaderboard(
        { gameId: 'g1', name: 'Times', sortOrder: 'asc' },
        makeCtx(),
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.sortOrder).toBe('asc');
    });

    it('returns error on fetch failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal error' }),
      });
      const result = await leaderboardHandlers.create_leaderboard(
        { gameId: 'g1', name: 'Scores' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Internal error');
    });

    it('returns HTTP status when response body has no error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({}),
      });
      const result = await leaderboardHandlers.create_leaderboard(
        { gameId: 'g1', name: 'Scores' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 403');
    });

    it('validates empty gameId', async () => {
      const result = await leaderboardHandlers.create_leaderboard(
        { gameId: '', name: 'Scores' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
    });

    it('validates empty name', async () => {
      const result = await leaderboardHandlers.create_leaderboard(
        { gameId: 'g1', name: '' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
    });

    it('validates maxEntries > 1000', async () => {
      const result = await leaderboardHandlers.create_leaderboard(
        { gameId: 'g1', name: 'Scores', maxEntries: 1001 },
        makeCtx(),
      );
      expect(result.success).toBe(false);
    });

    it('validates maxEntries < 1', async () => {
      const result = await leaderboardHandlers.create_leaderboard(
        { gameId: 'g1', name: 'Scores', maxEntries: 0 },
        makeCtx(),
      );
      expect(result.success).toBe(false);
    });
  });

  describe('list_leaderboards', () => {
    it('lists leaderboards successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ leaderboards: [{ name: 'High Scores' }, { name: 'Fastest' }] }),
      });
      const result = await leaderboardHandlers.list_leaderboards(
        { gameId: 'g1' },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain('2 leaderboard(s)');
      const data = result.result as Record<string, unknown>;
      expect((data.leaderboards as unknown[]).length).toBe(2);
    });

    it('returns error on fetch failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'Game not found' }),
      });
      const result = await leaderboardHandlers.list_leaderboards(
        { gameId: 'missing' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Game not found');
    });
  });

  describe('configure_leaderboard', () => {
    it('updates leaderboard config successfully', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
      const result = await leaderboardHandlers.configure_leaderboard(
        { gameId: 'g1', name: 'Scores', sortOrder: 'asc', maxEntries: 500 },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain('Scores');
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/publish/g1/leaderboards/Scores',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });

    it('sends correct body fields', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
      await leaderboardHandlers.configure_leaderboard(
        { gameId: 'g1', name: 'Scores', maxEntries: 200, minScore: 0, maxScore: 999 },
        makeCtx(),
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.maxEntries).toBe(200);
      expect(body.minScore).toBe(0);
      expect(body.maxScore).toBe(999);
    });

    it('returns error on fetch failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'DB error' }),
      });
      const result = await leaderboardHandlers.configure_leaderboard(
        { gameId: 'g1', name: 'Scores' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('DB error');
    });
  });

  describe('delete_leaderboard', () => {
    it('deletes leaderboard successfully', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
      const result = await leaderboardHandlers.delete_leaderboard(
        { gameId: 'g1', name: 'Old Scores' },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain('Old Scores');
      expect(result.message).toContain('deleted');
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/publish/g1/leaderboards/Old%20Scores',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('returns error on fetch failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'Not found' }),
      });
      const result = await leaderboardHandlers.delete_leaderboard(
        { gameId: 'g1', name: 'Missing' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Not found');
    });

    it('handles json parse failure in error response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('not json')),
      });
      const result = await leaderboardHandlers.delete_leaderboard(
        { gameId: 'g1', name: 'Broken' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 500');
    });
  });
});
