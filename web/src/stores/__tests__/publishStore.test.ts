/**
 * Unit tests for the publishStore Zustand store.
 *
 * Tests cover cloud publishing, slug checking, publication listing,
 * and error handling for publish operations.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { usePublishStore, type PublishedGameInfo } from '../publishStore';

// Mock fetch globally
global.fetch = vi.fn();

describe('publishStore', () => {
  const mockPublication: PublishedGameInfo = {
    id: 'pub-123',
    slug: 'my-game',
    title: 'My Game',
    description: 'A test game',
    status: 'published',
    version: 1,
    playCount: 0,
    url: 'https://forge.example.com/play/my-game',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    // Reset store to initial state
    usePublishStore.setState({
      publications: [],
      isPublishing: false,
      publishError: null,
    });

    // Reset fetch mock
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initial State', () => {
    it('should initialize with empty publications', () => {
      const state = usePublishStore.getState();
      expect(state.publications).toEqual([]);
    });

    it('should initialize with isPublishing false', () => {
      const state = usePublishStore.getState();
      expect(state.isPublishing).toBe(false);
    });

    it('should initialize with no error', () => {
      const state = usePublishStore.getState();
      expect(state.publishError).toBeNull();
    });
  });

  describe('fetchPublications', () => {
    it('should fetch and store publications', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ publications: [mockPublication] }),
      });

      const { fetchPublications } = usePublishStore.getState();
      await fetchPublications();

      const state = usePublishStore.getState();
      expect(state.publications).toEqual([mockPublication]);
      expect(global.fetch).toHaveBeenCalledWith('/api/publish/list');
    });

    it('should handle empty publications list', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ publications: [] }),
      });

      const { fetchPublications } = usePublishStore.getState();
      await fetchPublications();

      const state = usePublishStore.getState();
      expect(state.publications).toEqual([]);
    });

    it('should handle fetch error silently', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

      const { fetchPublications } = usePublishStore.getState();
      await fetchPublications();

      const state = usePublishStore.getState();
      expect(state.publications).toEqual([]);
    });

    it('should handle non-ok response silently', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { fetchPublications } = usePublishStore.getState();
      await fetchPublications();

      const state = usePublishStore.getState();
      expect(state.publications).toEqual([]);
    });

    it('should handle missing publications field', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const { fetchPublications } = usePublishStore.getState();
      await fetchPublications();

      const state = usePublishStore.getState();
      expect(state.publications).toEqual([]);
    });
  });

  describe('publishGame', () => {
    it('should publish a game successfully', async () => {
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ publication: mockPublication }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ publications: [mockPublication] }),
        });

      const { publishGame } = usePublishStore.getState();
      const result = await publishGame('proj-1', 'My Game', 'my-game', 'A test game');

      expect(result).toEqual(mockPublication);
      expect(global.fetch).toHaveBeenCalledWith('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'proj-1',
          title: 'My Game',
          slug: 'my-game',
          description: 'A test game',
        }),
      });

      const state = usePublishStore.getState();
      expect(state.isPublishing).toBe(false);
      expect(state.publishError).toBeNull();
    });

    it('should publish without description', async () => {
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ publication: mockPublication }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ publications: [] }),
        });

      const { publishGame } = usePublishStore.getState();
      const result = await publishGame('proj-1', 'My Game', 'my-game');

      expect(result).toEqual(mockPublication);
      expect(global.fetch).toHaveBeenCalledWith('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'proj-1',
          title: 'My Game',
          slug: 'my-game',
          description: undefined,
        }),
      });
    });

    it('should set isPublishing during publish', async () => {
      let resolvePublish: (value: unknown) => void;
      const publishPromise = new Promise((resolve) => {
        resolvePublish = resolve;
      });

      (global.fetch as ReturnType<typeof vi.fn>).mockReturnValueOnce(publishPromise);

      const { publishGame } = usePublishStore.getState();
      const publishCall = publishGame('proj-1', 'My Game', 'my-game');

      // Check isPublishing is true during the operation
      expect(usePublishStore.getState().isPublishing).toBe(true);

      // Resolve the promise
      resolvePublish!({
        ok: true,
        json: async () => ({ publication: mockPublication }),
      });

      // Mock fetchPublications
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ publications: [] }),
      });

      await publishCall;

      // Check isPublishing is false after completion
      expect(usePublishStore.getState().isPublishing).toBe(false);
    });

    it('should handle publish error with JSON response', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Slug already taken' }),
      });

      const { publishGame } = usePublishStore.getState();
      const result = await publishGame('proj-1', 'My Game', 'my-game');

      expect(result).toBeNull();
      const state = usePublishStore.getState();
      expect(state.isPublishing).toBe(false);
      expect(state.publishError).toBe('Slug already taken');
    });

    it('should handle publish error without JSON response', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      const { publishGame } = usePublishStore.getState();
      const result = await publishGame('proj-1', 'My Game', 'my-game');

      expect(result).toBeNull();
      const state = usePublishStore.getState();
      expect(state.publishError).toBe('Publish failed');
    });

    it('should handle network error', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

      const { publishGame } = usePublishStore.getState();
      const result = await publishGame('proj-1', 'My Game', 'my-game');

      expect(result).toBeNull();
      const state = usePublishStore.getState();
      expect(state.isPublishing).toBe(false);
      expect(state.publishError).toBe('Network error');
    });

    it('should clear previous error on new publish', async () => {
      usePublishStore.setState({ publishError: 'Previous error' });

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ publication: mockPublication }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ publications: [] }),
        });

      const { publishGame } = usePublishStore.getState();
      await publishGame('proj-1', 'My Game', 'my-game');

      const state = usePublishStore.getState();
      expect(state.publishError).toBeNull();
    });
  });

  describe('unpublishGame', () => {
    it('should unpublish a game successfully', async () => {
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ publications: [] }),
        });

      const { unpublishGame } = usePublishStore.getState();
      const result = await unpublishGame('pub-123');

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith('/api/publish/pub-123', { method: 'DELETE' });
    });

    it('should handle unpublish error', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const { unpublishGame } = usePublishStore.getState();
      const result = await unpublishGame('pub-123');

      expect(result).toBe(false);
    });

    it('should handle network error', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

      const { unpublishGame } = usePublishStore.getState();
      const result = await unpublishGame('pub-123');

      expect(result).toBe(false);
    });
  });

  describe('checkSlug', () => {
    it('should return true for available slug', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ available: true }),
      });

      const { checkSlug } = usePublishStore.getState();
      const result = await checkSlug('my-game');

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith('/api/publish/check-slug?slug=my-game');
    });

    it('should return false for unavailable slug', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ available: false }),
      });

      const { checkSlug } = usePublishStore.getState();
      const result = await checkSlug('taken-slug');

      expect(result).toBe(false);
    });

    it('should encode special characters in slug', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ available: true }),
      });

      const { checkSlug } = usePublishStore.getState();
      await checkSlug('my game!');

      expect(global.fetch).toHaveBeenCalledWith('/api/publish/check-slug?slug=my%20game!');
    });

    it('should handle non-ok response', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { checkSlug } = usePublishStore.getState();
      const result = await checkSlug('my-game');

      expect(result).toBe(false);
    });

    it('should handle network error', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

      const { checkSlug } = usePublishStore.getState();
      const result = await checkSlug('my-game');

      expect(result).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple publications', async () => {
      const pub1 = { ...mockPublication, id: 'pub-1', slug: 'game-1' };
      const pub2 = { ...mockPublication, id: 'pub-2', slug: 'game-2' };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ publications: [pub1, pub2] }),
      });

      const { fetchPublications } = usePublishStore.getState();
      await fetchPublications();

      const state = usePublishStore.getState();
      expect(state.publications).toHaveLength(2);
      expect(state.publications[0].slug).toBe('game-1');
      expect(state.publications[1].slug).toBe('game-2');
    });

    it('should handle empty slug', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ available: false }),
      });

      const { checkSlug } = usePublishStore.getState();
      const result = await checkSlug('');

      expect(result).toBe(false);
      expect(global.fetch).toHaveBeenCalledWith('/api/publish/check-slug?slug=');
    });

    it('should handle publication with null description', async () => {
      const pubWithNullDesc = { ...mockPublication, description: null };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ publications: [pubWithNullDesc] }),
      });

      const { fetchPublications } = usePublishStore.getState();
      await fetchPublications();

      const state = usePublishStore.getState();
      expect(state.publications[0].description).toBeNull();
    });

    it('should handle unknown error type', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce('String error');

      const { publishGame } = usePublishStore.getState();
      const result = await publishGame('proj-1', 'My Game', 'my-game');

      expect(result).toBeNull();
      const state = usePublishStore.getState();
      expect(state.publishError).toBe('Unknown error');
    });
  });
});
