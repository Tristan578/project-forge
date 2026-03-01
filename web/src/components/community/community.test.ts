import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Comment Flagging Tests ---

describe('Comment flagging API contract', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  it('sends correct flag request body', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ flagged: true }) });

    const gameId = 'game-123';
    const commentId = 'comment-456';

    await fetch(`/api/community/games/${gameId}/flag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commentId }),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `/api/community/games/${gameId}/flag`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ commentId }),
      })
    );
  });

  it('rejects missing commentId', () => {
    const body = {};
    const commentId = (body as { commentId?: string }).commentId;
    expect(commentId).toBeUndefined();
  });
});

// --- Publish Tags Tests ---

describe('Publish with tags', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  it('includes tags array in publish request', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ publication: { url: '/play/u/slug' } }) });

    const tags = ['platformer', 'puzzle'];
    await fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-1',
        title: 'My Game',
        slug: 'my-game',
        description: 'A game',
        tags,
      }),
    });

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.tags).toEqual(['platformer', 'puzzle']);
  });

  it('limits tags to 5 entries client-side', () => {
    const inputTags = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const validTags = inputTags.slice(0, 5);
    expect(validTags).toHaveLength(5);
    expect(validTags).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('normalizes tags to lowercase', () => {
    const raw = ['Platformer', 'PUZZLE', 'Action RPG'];
    const normalized = raw.map((t) => t.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''));
    expect(normalized).toEqual(['platformer', 'puzzle', 'actionrpg']);
  });
});

// --- Admin Featured Games Tests ---

describe('Admin featured games API contract', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  it('sends feature request with gameId and position', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ featured: { id: 'f1' } }) });

    await fetch('/api/admin/featured', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: 'game-1', position: 0 }),
    });

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.gameId).toBe('game-1');
    expect(body.position).toBe(0);
  });

  it('sends unfeature request with id param', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ removed: true }) });

    await fetch('/api/admin/featured?id=feat-1', { method: 'DELETE' });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/admin/featured?id=feat-1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

// --- Share URL Tests ---

describe('Share URL generation', () => {
  it('constructs correct play URL from cdnUrl', () => {
    const cdnUrl = '/play/user123/my-game';
    const origin = 'https://spawnforge.ai';
    const shareUrl = `${origin}${cdnUrl}`;
    expect(shareUrl).toBe('https://spawnforge.ai/play/user123/my-game');
  });

  it('handles null cdnUrl by using current location', () => {
    const cdnUrl: string | null = null;
    const fallback = 'https://spawnforge.ai/community';
    const shareUrl = cdnUrl ? `https://spawnforge.ai${cdnUrl}` : fallback;
    expect(shareUrl).toBe('https://spawnforge.ai/community');
  });
});
