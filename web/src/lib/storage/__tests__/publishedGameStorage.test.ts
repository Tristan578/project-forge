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
  it('derives games/{userId}/{slug}/v{version}/bundle.json', () => {
    expect(buildPublishedGameKey('clerk_abc123', 'my-cool-game', 1)).toBe(
      'games/clerk_abc123/my-cool-game/v1/bundle.json',
    );
  });

  it('puts each version at its own immutable key (never overwrites in place)', () => {
    // The decisive property of the round-2 fix: two versions of the same slug
    // resolve to DIFFERENT objects, so a republish can never clobber the
    // previous version's bytes.
    const v1 = buildPublishedGameKey('user_1', 'a-b-c-1', 1);
    const v2 = buildPublishedGameKey('user_1', 'a-b-c-1', 2);
    expect(v1).toBe('games/user_1/a-b-c-1/v1/bundle.json');
    expect(v2).toBe('games/user_1/a-b-c-1/v2/bundle.json');
    expect(v1).not.toBe(v2);
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
    expect(() => buildPublishedGameKey(userId, slug, 1)).toThrow(/rejected/i);
  });

  const unsafeVersions: Array<[string, number]> = [
    ['zero', 0],
    ['negative', -1],
    ['non-integer', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ];

  it.each(unsafeVersions)('rejects a %s version before producing a key', (_label, version) => {
    expect(() => buildPublishedGameKey('user_1', 'game', version)).toThrow(
      /version must be a positive integer/i,
    );
  });
});

describe('writePublishedGameBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadToR2.mockResolvedValue({
      key: 'games/clerk_1/g/v1/bundle.json',
      url: 'https://cdn.test/games/clerk_1/g/v1/bundle.json',
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

  it('derives the key from manifest.version so the object and its version can never disagree', async () => {
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
    // The version segment comes straight from the manifest — v4, not a stable
    // 'bundle.json'.
    expect(key).toBe('games/clerk_1/my-game/v4/bundle.json');
    expect(contentType).toBe('application/json');

    const parsed = JSON.parse(Buffer.from(body as Buffer).toString('utf-8'));
    expect(parsed).toEqual({ sceneData, manifest });
    expect(parsed.manifest).toMatchObject({
      version: 4,
      publishedAt: '2026-09-15T12:00:00.000Z',
      slug: 'my-game',
      userId: 'clerk_1',
    });

    expect(result.key).toBe('games/clerk_1/g/v1/bundle.json');
    expect(result.url).toContain('https://cdn.test/');
  });
});

describe('readPublishedGameBundle', () => {
  const goodManifest = { version: 2, publishedAt: 'x', slug: 'g', userId: 'u' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the version-specific key and returns a well-formed, matching bundle', async () => {
    const bundle = { sceneData: { entities: [] }, manifest: goodManifest };
    getObjectFromR2.mockResolvedValue(JSON.stringify(bundle));

    const result = await readPublishedGameBundle('u', 'g', 2);

    // The read is keyed by the requested version, so it can only ever fetch the
    // object the DB row's version points at.
    expect(getObjectFromR2).toHaveBeenCalledWith('games/u/g/v2/bundle.json');
    expect(result).toEqual(bundle);
  });

  it('throws when the object read throws (missing / transport)', async () => {
    getObjectFromR2.mockRejectedValue(new Error('NoSuchKey'));
    await expect(readPublishedGameBundle('u', 'g', 2)).rejects.toThrow('NoSuchKey');
  });

  it('throws on malformed JSON', async () => {
    getObjectFromR2.mockResolvedValue('{not json');
    await expect(readPublishedGameBundle('u', 'g', 2)).rejects.toThrow();
  });

  it('throws on valid JSON that is not a bundle (no sceneData)', async () => {
    getObjectFromR2.mockResolvedValue(JSON.stringify({ manifest: goodManifest }));
    await expect(readPublishedGameBundle('u', 'g', 2)).rejects.toThrow(/malformed/i);
  });

  it('rejects a bundle whose manifest version does not match the requested version', async () => {
    // The stale-read guard (#7580 review round 2, item 2): a bundle whose
    // manifest declares a different version than the DB row asked for must be
    // treated as stale and rejected so the play route falls back to Postgres —
    // never served as if it were the current publication.
    getObjectFromR2.mockResolvedValue(
      JSON.stringify({ sceneData: {}, manifest: { ...goodManifest, version: 3 } }),
    );
    await expect(readPublishedGameBundle('u', 'g', 2)).rejects.toThrow(/stale|mismatch/i);
  });

  it('rejects a bundle whose manifest slug/userId does not match', async () => {
    getObjectFromR2.mockResolvedValue(
      JSON.stringify({ sceneData: {}, manifest: { ...goodManifest, slug: 'other' } }),
    );
    await expect(readPublishedGameBundle('u', 'g', 2)).rejects.toThrow(/stale|mismatch/i);

    getObjectFromR2.mockResolvedValue(
      JSON.stringify({ sceneData: {}, manifest: { ...goodManifest, userId: 'someone-else' } }),
    );
    await expect(readPublishedGameBundle('u', 'g', 2)).rejects.toThrow(/stale|mismatch/i);
  });

  it('rejects an unsafe key before any R2 read', async () => {
    await expect(readPublishedGameBundle('u', '..' + '/x', 2)).rejects.toThrow(/rejected/i);
    expect(getObjectFromR2).not.toHaveBeenCalled();
  });
});
