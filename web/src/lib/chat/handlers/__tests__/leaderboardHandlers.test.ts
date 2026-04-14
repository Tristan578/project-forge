/**
 * Tests for leaderboardHandlers — CRUD operations on game leaderboards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler } from './handlerTestUtils';
import { leaderboardHandlers } from '../leaderboardHandlers';

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// create_leaderboard
// ---------------------------------------------------------------------------

describe('leaderboardHandlers', () => {
  describe('create_leaderboard', () => {
    it('creates a leaderboard with default sort order', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ id: 'lb1' }), { status: 200 })
      );

      const { result } = await invokeHandler(leaderboardHandlers, 'create_leaderboard', {
        gameId: 'game_1',
        name: 'High Scores',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('High Scores');
      expect(result.message).toContain('desc');

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe('/api/publish/game_1/leaderboards');
      expect(call[1]?.method).toBe('POST');
      const body = JSON.parse(call[1]?.body as string);
      expect(body.sortOrder).toBe('desc');
    });

    it('creates a leaderboard with custom options', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ id: 'lb2' }), { status: 200 })
      );

      const { result } = await invokeHandler(leaderboardHandlers, 'create_leaderboard', {
        gameId: 'game_2',
        name: 'Fastest Times',
        sortOrder: 'asc',
        maxEntries: 100,
        minScore: 0,
        maxScore: 9999,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('asc');

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.sortOrder).toBe('asc');
      expect(body.maxEntries).toBe(100);
      expect(body.minScore).toBe(0);
      expect(body.maxScore).toBe(9999);
    });

    it('returns error on API failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: 'Game not found' }), { status: 404 })
      );

      const { result } = await invokeHandler(leaderboardHandlers, 'create_leaderboard', {
        gameId: 'missing',
        name: 'Scores',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Game not found');
    });

    it('handles non-JSON error response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Internal Server Error', { status: 500 })
      );

      const { result } = await invokeHandler(leaderboardHandlers, 'create_leaderboard', {
        gameId: 'game_1',
        name: 'Scores',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 500');
    });

    it('rejects missing gameId', async () => {
      const { result } = await invokeHandler(leaderboardHandlers, 'create_leaderboard', {
        name: 'Scores',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('rejects missing name', async () => {
      const { result } = await invokeHandler(leaderboardHandlers, 'create_leaderboard', {
        gameId: 'game_1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('rejects maxEntries out of range', async () => {
      const { result } = await invokeHandler(leaderboardHandlers, 'create_leaderboard', {
        gameId: 'game_1',
        name: 'Scores',
        maxEntries: 5000,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('rejects invalid sortOrder', async () => {
      const { result } = await invokeHandler(leaderboardHandlers, 'create_leaderboard', {
        gameId: 'game_1',
        name: 'Scores',
        sortOrder: 'random',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });
  });

  // ---------------------------------------------------------------------------
  // list_leaderboards
  // ---------------------------------------------------------------------------

  describe('list_leaderboards', () => {
    it('returns leaderboards for a game', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ leaderboards: [{ name: 'Scores' }, { name: 'Times' }] }), { status: 200 })
      );

      const { result } = await invokeHandler(leaderboardHandlers, 'list_leaderboards', {
        gameId: 'game_1',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('2 leaderboard(s)');
      expect((result.result as { leaderboards: unknown[] }).leaderboards).toHaveLength(2);
    });

    it('returns error on API failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
      );

      const { result } = await invokeHandler(leaderboardHandlers, 'list_leaderboards', {
        gameId: 'game_1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Forbidden');
    });

    it('rejects empty gameId', async () => {
      const { result } = await invokeHandler(leaderboardHandlers, 'list_leaderboards', {
        gameId: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });
  });

  // ---------------------------------------------------------------------------
  // configure_leaderboard
  // ---------------------------------------------------------------------------

  describe('configure_leaderboard', () => {
    it('updates leaderboard configuration', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );

      const { result } = await invokeHandler(leaderboardHandlers, 'configure_leaderboard', {
        gameId: 'game_1',
        name: 'Scores',
        sortOrder: 'asc',
        maxEntries: 50,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('Scores');

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe('/api/publish/game_1/leaderboards/Scores');
      expect(call[1]?.method).toBe('PATCH');
    });

    it('allows nullable minScore and maxScore', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );

      const { result } = await invokeHandler(leaderboardHandlers, 'configure_leaderboard', {
        gameId: 'game_1',
        name: 'Scores',
        minScore: null,
        maxScore: null,
      });

      expect(result.success).toBe(true);
    });

    it('returns error on API failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
      );

      const { result } = await invokeHandler(leaderboardHandlers, 'configure_leaderboard', {
        gameId: 'game_1',
        name: 'Missing',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Not found');
    });

    it('URL-encodes special characters in gameId and name', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );

      await invokeHandler(leaderboardHandlers, 'configure_leaderboard', {
        gameId: 'game/special',
        name: 'top scores',
      });

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe('/api/publish/game%2Fspecial/leaderboards/top%20scores');
    });
  });

  // ---------------------------------------------------------------------------
  // delete_leaderboard
  // ---------------------------------------------------------------------------

  describe('delete_leaderboard', () => {
    it('deletes a leaderboard', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );

      const { result } = await invokeHandler(leaderboardHandlers, 'delete_leaderboard', {
        gameId: 'game_1',
        name: 'Scores',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('deleted');
      expect(result.message).toContain('Scores');

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe('/api/publish/game_1/leaderboards/Scores');
      expect(call[1]?.method).toBe('DELETE');
    });

    it('returns error on API failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
      );

      const { result } = await invokeHandler(leaderboardHandlers, 'delete_leaderboard', {
        gameId: 'game_1',
        name: 'Scores',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unauthorized');
    });

    it('rejects missing name', async () => {
      const { result } = await invokeHandler(leaderboardHandlers, 'delete_leaderboard', {
        gameId: 'game_1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });
  });
});
