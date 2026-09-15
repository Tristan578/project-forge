import { describe, it, expect, vi, beforeEach } from 'vitest';

// The storage module is the unit under test; R2 transport is mocked so these
// assert key derivation, unsafe-input rejection, and the bundle body shape
// WITHOUT any network. See r2.test.ts for the transport itself.
const uploadToR2 = vi.fn();
const getObjectFromR2 = vi.fn();

vi.mock('@/lib/storage/r2', () => ({
  uploadToR2: (...args: unknown[]) => uploadToR2(...args),
  getObjectFromR2: (...args: unknown[]) => getObjectFromR2(...args),
}));

import {
  buildPublishedGameKey,
  writePublishedGameBundle,
  readPublishedGameBundle,
} from '../publishedGameStorage';

const TAB = String.fromCharCode(9);
const NEWLINE = String.fromCharCode(10);
const DEL = String.fromCharCode(127);
const BACKSLASH = String.fromCharCode(92);

describe('buildPublishedGameKey', () => {
  it('derives games/{userId}/{slug}/bundle.json', () => {
    expect(buildPublishedGameKey('clerk_abc123', 'my-cool-game')).toBe(
      'games/clerk_abc123/my-cool-game/bundle.json',
    );
  });

  it('keeps hyphens in a normal slug (does not over-reject)', () => {
    expect(buildPublishedGameKey('user_1', 'a-b-c-1')).toBe(
      'games/user_1/a-b-c-1/bundle.json',
    );
  });

  const unsafe: Array<[string, string, string]> = [
    ['path traversal in slug', 'user_1', '..' + '/secret'],
    ['path traversal in userId', '..' + '/etc', 'game'],
    ['forward slash in slug', 'user_1', 'a/b'],
    ['backslash in userId', 'user' + BACKSLASH + '1', 'game'],
    ['percent-encoding in slug', 'user_1', 'a%2e%2e'],
    ['tab control char in slug', 'user_1', 'a' + TAB + 'b'],
    ['newline control char in slug', 'user_1', 'a' + NEWLINE + 'b'],
    ['DEL char in userId', 'user1' + DEL, 'game'],
    ['empty slug', 'user_1', ''],
    ['empty userId', '', 'game'],
  ];

  it.each(unsafe)('rejects %s before producing a key', (_label, userId, slug) => {
    expect(() => buildPublishedGameKey(userId, slug)).toThrow(/rejected/i);
  });
});

describe('writePublishedGameBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadToR2.mockResolvedValue({
      key: 'games/clerk_1/g/bundle.json',
      url: 'https://cdn.test/games/clerk_1/g/bundle.json',
    });
  });

  it('rejects an unsafe slug BEFORE any R2 call', async () => {
    await expect(
      writePublishedGameBundle('clerk_1', '..' + '/evil', { a: 1 }, {
        version: 1,
        publishedAt: '2026-09-15T00:00:00.000Z',
        slug: 'evil',
        userId: 'clerk_1',
      }),
    ).rejects.toThrow(/rejected/i);
    expect(uploadToR2).not.toHaveBeenCalled();
  });

  it('calls uploadToR2 with the derived key and a JSON body of sceneData + manifest', async () => {
    const sceneData = { entities: [{ id: 'e1' }], metadata: { title: 'x' } };
    const manifest = {
      version: 4,
      publishedAt: '2026-09-15T12:00:00.000Z',
      slug: 'my-game',
      userId: 'clerk_1',
    };

    const result = await writePublishedGameBundle('clerk_1', 'my-game', sceneData, manifest);

    expect(uploadToR2).toHaveBeenCalledTimes(1);
    const [key, body, contentType] = uploadToR2.mock.calls[0];
    expect(key).toBe('games/clerk_1/my-game/bundle.json');
    expect(contentType).toBe('application/json');

    const parsed = JSON.parse(Buffer.from(body as Buffer).toString('utf-8'));
    expect(parsed).toEqual({ sceneData, manifest });
    expect(parsed.manifest).toMatchObject({
      version: 4,
      publishedAt: '2026-09-15T12:00:00.000Z',
      slug: 'my-game',
      userId: 'clerk_1',
    });

    expect(result.key).toBe('games/clerk_1/g/bundle.json');
    expect(result.url).toContain('https://cdn.test/');
  });
});

describe('readPublishedGameBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads and parses a well-formed bundle', async () => {
    const bundle = {
      sceneData: { entities: [] },
      manifest: { version: 1, publishedAt: 'x', slug: 'g', userId: 'u' },
    };
    getObjectFromR2.mockResolvedValue(JSON.stringify(bundle));

    const result = await readPublishedGameBundle('u', 'g');

    expect(getObjectFromR2).toHaveBeenCalledWith('games/u/g/bundle.json');
    expect(result).toEqual(bundle);
  });

  it('throws when the object read throws (missing / transport)', async () => {
    getObjectFromR2.mockRejectedValue(new Error('NoSuchKey'));
    await expect(readPublishedGameBundle('u', 'g')).rejects.toThrow('NoSuchKey');
  });

  it('throws on malformed JSON', async () => {
    getObjectFromR2.mockResolvedValue('{not json');
    await expect(readPublishedGameBundle('u', 'g')).rejects.toThrow();
  });

  it('throws on valid JSON that is not a bundle (no sceneData)', async () => {
    getObjectFromR2.mockResolvedValue(JSON.stringify({ manifest: {} }));
    await expect(readPublishedGameBundle('u', 'g')).rejects.toThrow(/malformed/i);
  });

  it('rejects an unsafe key before any R2 read', async () => {
    await expect(readPublishedGameBundle('u', '..' + '/x')).rejects.toThrow(/rejected/i);
    expect(getObjectFromR2).not.toHaveBeenCalled();
  });
});
