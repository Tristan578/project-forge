import { describe, it, expect, vi, beforeEach } from 'vitest';

const putPrivateObjectToR2 = vi.fn();
const getObjectFromR2 = vi.fn();
const deleteManyFromR2 = vi.fn();
vi.mock('@/lib/storage/r2', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/storage/r2')>(),
  putPrivateObjectToR2: (...args: unknown[]) => putPrivateObjectToR2(...args),
  getObjectFromR2: (...args: unknown[]) => getObjectFromR2(...args),
  deleteManyFromR2: (...args: unknown[]) => deleteManyFromR2(...args),
}));
const captureException = vi.fn();
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

import {
  buildPublishedGameKey, resolveOwnedPublishedGameKey, writePublishedGameBundle,
  readPublishedGameBundle, deletePublishedGameBundle,
} from '../publishedGameStorage';

const user = 'clerk_1';
const slug = 'my-game';
const key = 'games/clerk_1/my-game/7179eeca-ffba-48b3-9897-c598813a8bd5/bundle.json';
const manifest = {
  schemaVersion: 1 as const, version: 4, publishedAt: '2026-09-15T12:00:00.000Z',
  slug, userId: user,
};
const bundle = { sceneData: { entities: [{ id: 'e1' }] }, manifest };
beforeEach(() => {
  vi.clearAllMocks();
  putPrivateObjectToR2.mockResolvedValue(undefined);
  deleteManyFromR2.mockResolvedValue({ requested: 2, deleted: 2, failedKeys: [], errors: [], truncated: false });
});

describe('immutable publication storage', () => {
  it('allocates independent keys for concurrent versions, including identical version numbers', async () => {
    const [a, b] = await Promise.all([
      writePublishedGameBundle(user, slug, bundle.sceneData, manifest),
      writePublishedGameBundle(user, slug, { entities: [] }, manifest),
    ]);
    expect(a.key).not.toBe(b.key);
    expect(resolveOwnedPublishedGameKey(a.key, user, slug)).toBe(a.key);
    expect(resolveOwnedPublishedGameKey(b.key, user, slug)).toBe(b.key);
    expect(putPrivateObjectToR2.mock.calls.map(([k]) => k)).toEqual([a.key, b.key]);
  });

  it('stores a private JSON snapshot without returning a public object URL', async () => {
    const result = await writePublishedGameBundle(user, slug, bundle.sceneData, manifest);
    expect(Object.keys(result)).toEqual(['key']);
    expect(JSON.parse(putPrivateObjectToR2.mock.calls[0][1].toString())).toEqual(bundle);
    expect(putPrivateObjectToR2.mock.calls[0][2]).toBe('application/json');
  });

  it.each(['', '../other', 'a/b', 'a\\b', 'a%2f', 'a b', 'a' + String.fromCharCode(10)])(
    'rejects unsafe identity %j before storage', async (unsafe) => {
      expect(() => buildPublishedGameKey(user, unsafe)).toThrow(/rejected/);
      expect(() => buildPublishedGameKey(unsafe, slug)).toThrow(/rejected/);
      expect(putPrivateObjectToR2).not.toHaveBeenCalled();
    },
  );

  it.each([
    key.replace('clerk_1', 'clerk_2'),
    key.replace('my-game', 'other-game'),
    key + '/extra',
    key.replace('/7179eeca-ffba-48b3-9897-c598813a8bd5/', '/'),
    key.replace('/bundle.json', '/other.json'),
    key.replace('7179eeca-ffba-48b3-9897-c598813a8bd5', '..'),
    'assets/clerk_1/my-game/file/game.json',
  ])('rejects an unowned or malformed stored key %s before read/deletion', async (unsafe) => {
    await expect(readPublishedGameBundle(unsafe, user, slug, 4)).rejects.toThrow(/rejected/);
    await deletePublishedGameBundle(unsafe, user, slug);
    expect(getObjectFromR2).not.toHaveBeenCalled();
    expect(deleteManyFromR2).not.toHaveBeenCalled();
  });

  it('reads the exact key stored on the publication', async () => {
    getObjectFromR2.mockResolvedValue(JSON.stringify(bundle));
    expect(await readPublishedGameBundle(key, user, slug, 4)).toEqual(bundle);
    expect(getObjectFromR2).toHaveBeenCalledWith(key);
  });

  it.each([
    null, [], 'scene', 42,
    { sceneData: null, manifest },
    { sceneData: [], manifest },
    { sceneData: 'scene', manifest },
    { sceneData: {} },
    { sceneData: {}, manifest: { ...manifest, schemaVersion: 2 } },
    { sceneData: {}, manifest: { ...manifest, version: 3 } },
    { sceneData: {}, manifest: { ...manifest, version: 4.1 } },
    { sceneData: {}, manifest: { ...manifest, userId: 'other' } },
    { sceneData: {}, manifest: { ...manifest, slug: 'other' } },
    { sceneData: {}, manifest: { ...manifest, publishedAt: 'yesterday' } },
  ])('rejects malformed or mismatched bundle %#', async (value) => {
    getObjectFromR2.mockResolvedValue(JSON.stringify(value));
    await expect(readPublishedGameBundle(key, user, slug, 4)).rejects.toThrow();
  });

  it('rejects malformed JSON and propagates missing objects', async () => {
    getObjectFromR2.mockResolvedValueOnce('{invalid');
    await expect(readPublishedGameBundle(key, user, slug, 4)).rejects.toThrow();
    getObjectFromR2.mockRejectedValueOnce(new Error('NoSuchKey'));
    await expect(readPublishedGameBundle(key, user, slug, 4)).rejects.toThrow('NoSuchKey');
  });

  it('rejects a mismatched manifest before writing', async () => {
    await expect(writePublishedGameBundle(user, slug, {}, { ...manifest, userId: 'other' })).rejects.toThrow();
    expect(putPrivateObjectToR2).not.toHaveBeenCalled();
  });

  it('cleans up an uncertain failed upload, including its derived sidecar', async () => {
    putPrivateObjectToR2.mockRejectedValue(new Error('upload failed'));
    await expect(writePublishedGameBundle(user, slug, {}, manifest)).rejects.toThrow('upload failed');
    const writtenKey = putPrivateObjectToR2.mock.calls[0][0];
    expect(deleteManyFromR2).toHaveBeenCalledWith([writtenKey, writtenKey + '.status.json']);
  });

  it('reports cleanup failures without failing the committed operation', async () => {
    deleteManyFromR2.mockResolvedValue({ failedKeys: [key], truncated: false });
    await expect(deletePublishedGameBundle(key, user, slug)).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ key }));
    deleteManyFromR2.mockRejectedValue(new Error('transport failure'));
    await expect(deletePublishedGameBundle(key, user, slug)).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledTimes(2);
  });
});
