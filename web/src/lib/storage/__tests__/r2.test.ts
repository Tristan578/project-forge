import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-s3', () => {
  const MockS3Client = class {
    send = mockSend;
  };
  return {
    S3Client: MockS3Client,
    PutObjectCommand: class { constructor(public args: unknown) {} },
    DeleteObjectCommand: class { constructor(public args: unknown) {} },
    DeleteObjectsCommand: class { constructor(public args: unknown) {} },
    HeadObjectCommand: class { constructor(public args: unknown) {} },
    GetObjectCommand: class { constructor(public args: unknown) {} },
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed-url.example.com/file'),
}));

describe('R2 storage client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.ASSET_R2_ACCOUNT_ID = 'test-account-id';
    process.env.ASSET_R2_ACCESS_KEY_ID = 'test-access-key';
    process.env.ASSET_R2_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.ASSET_BUCKET_NAME = 'test-bucket';
    process.env.CDN_URL = 'cdn.test.com';
  });

  describe('buildAssetKey', () => {
    it('builds correct key for file type', async () => {
      const { buildAssetKey } = await import('../r2');
      const key = buildAssetKey('seller-1', 'asset-1', 'model.glb', 'file');
      expect(key).toBe('assets/seller-1/asset-1/file/model.glb');
    });

    it('builds correct key for preview type', async () => {
      const { buildAssetKey } = await import('../r2');
      const key = buildAssetKey('seller-1', 'asset-1', 'thumb.png', 'preview');
      expect(key).toBe('assets/seller-1/asset-1/preview/thumb.png');
    });

    it('sanitizes filenames with special characters', async () => {
      const { buildAssetKey } = await import('../r2');
      const key = buildAssetKey('s1', 'a1', 'my file (1).glb', 'file');
      expect(key).toBe('assets/s1/a1/file/my_file__1_.glb');
    });
  });

  describe('uploadToR2', () => {
    it('uploads file and returns CDN URL', async () => {
      mockSend.mockResolvedValue({});
      const { uploadToR2 } = await import('../r2');

      const result = await uploadToR2('test/key.png', Buffer.from('data'), 'image/png');

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(result.url).toBe('https://cdn.test.com/test/key.png');
      expect(result.key).toBe('test/key.png');
    });

    it('throws when CDN_URL is not set (before uploading)', async () => {
      delete process.env.CDN_URL;
      mockSend.mockResolvedValue({});
      const { uploadToR2 } = await import('../r2');

      await expect(uploadToR2('test/key.png', Buffer.from('data'), 'image/png')).rejects.toThrow(
        'CDN_URL not configured'
      );
      // Should fail fast — no upload attempt when CDN_URL is missing
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('withStatusSidecars', () => {
    it('pairs every key with the post-processing Worker status sidecar', async () => {
      const { withStatusSidecars } = await import('../r2');

      expect(
        withStatusSidecars([
          'assets/s1/a1/file/model.glb',
          'assets/s1/a1/preview/thumb.png',
        ])
      ).toEqual([
        'assets/s1/a1/file/model.glb',
        'assets/s1/a1/file/model.glb.status.json',
        'assets/s1/a1/preview/thumb.png',
        'assets/s1/a1/preview/thumb.png.status.json',
      ]);
    });

    it('does not append a second suffix to a key that is already a sidecar', async () => {
      const { withStatusSidecars } = await import('../r2');

      expect(withStatusSidecars(['assets/s1/a1/file/model.glb.status.json'])).toEqual([
        'assets/s1/a1/file/model.glb.status.json',
      ]);
    });

    it('returns an empty list for no keys', async () => {
      const { withStatusSidecars } = await import('../r2');

      expect(withStatusSidecars([])).toEqual([]);
    });
  });

  describe('deleteFromR2 (removed)', () => {
    it('is no longer exported — deleteManyFromR2 is the only delete path', async () => {
      const r2 = await import('../r2');

      expect('deleteFromR2' in r2).toBe(false);
    });
  });

  describe('deleteManyFromR2', () => {
    function sentKeys(callIndex = 0): string[] {
      const command = mockSend.mock.calls[callIndex][0] as {
        args: { Delete: { Objects: { Key: string }[] } };
      };
      return command.args.Delete.Objects.map((o) => o.Key);
    }

    it('deletes every key in one batched request and reports the count', async () => {
      mockSend.mockResolvedValue({});
      const { deleteManyFromR2 } = await import('../r2');

      const result = await deleteManyFromR2([
        'assets/s1/a1/file/model.glb',
        'assets/s1/a1/preview/thumb.png',
      ]);

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(sentKeys()).toEqual([
        'assets/s1/a1/file/model.glb',
        'assets/s1/a1/preview/thumb.png',
      ]);
      const command = mockSend.mock.calls[0][0] as { args: { Bucket: string } };
      expect(command.args.Bucket).toBe('test-bucket');
      expect(result).toMatchObject({
        requested: 2,
        deleted: 2,
        failedKeys: [],
        truncated: false,
      });
    });

    it('is a no-op that never touches R2 for an empty key list', async () => {
      const { deleteManyFromR2 } = await import('../r2');

      const result = await deleteManyFromR2([]);

      expect(mockSend).not.toHaveBeenCalled();
      expect(result).toEqual({
        requested: 0,
        deleted: 0,
        failedKeys: [],
        errors: [],
        truncated: false,
      });
    });

    it('de-duplicates keys before sending', async () => {
      mockSend.mockResolvedValue({});
      const { deleteManyFromR2 } = await import('../r2');

      const result = await deleteManyFromR2(['k/1', 'k/1', 'k/2', '']);

      expect(sentKeys()).toEqual(['k/1', 'k/2']);
      expect(result.requested).toBe(2);
    });

    it('chunks into 1000-key requests instead of one request per object', async () => {
      mockSend.mockResolvedValue({});
      const { deleteManyFromR2 } = await import('../r2');

      const keys = Array.from({ length: 2500 }, (_, i) => `assets/s1/a${i}/file/f.glb`);
      const result = await deleteManyFromR2(keys);

      expect(mockSend).toHaveBeenCalledTimes(3);
      expect(sentKeys(0)).toHaveLength(1000);
      expect(sentKeys(1)).toHaveLength(1000);
      expect(sentKeys(2)).toHaveLength(500);
      expect(result.deleted).toBe(2500);
      expect(result.truncated).toBe(false);
    });

    it('caps the sweep at MAX_R2_SWEEP_KEYS and flags truncation', async () => {
      mockSend.mockResolvedValue({});
      const { deleteManyFromR2, MAX_R2_SWEEP_KEYS } = await import('../r2');

      const keys = Array.from({ length: MAX_R2_SWEEP_KEYS + 10 }, (_, i) => `k/${i}`);
      const result = await deleteManyFromR2(keys);

      expect(result.requested).toBe(MAX_R2_SWEEP_KEYS);
      expect(result.truncated).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(MAX_R2_SWEEP_KEYS / 1000);
    });

    it('never throws when the R2 request fails — it reports the keys instead', async () => {
      mockSend.mockRejectedValue(new Error('R2 unavailable'));
      const { deleteManyFromR2 } = await import('../r2');

      const result = await deleteManyFromR2(['k/1', 'k/2']);

      expect(result.deleted).toBe(0);
      expect(result.failedKeys).toEqual(['k/1', 'k/2']);
      expect(result.errors).toEqual(['R2 unavailable']);
    });

    it('never throws when R2 is not configured', async () => {
      delete process.env.ASSET_R2_ACCOUNT_ID;
      const { deleteManyFromR2 } = await import('../r2');

      const result = await deleteManyFromR2(['k/1']);

      expect(mockSend).not.toHaveBeenCalled();
      expect(result.failedKeys).toEqual(['k/1']);
      expect(result.errors[0]).toContain('R2 storage not configured');
    });

    it('reports per-key errors returned by R2 without failing the sweep', async () => {
      mockSend.mockResolvedValue({
        Errors: [{ Key: 'k/2', Code: 'AccessDenied', Message: 'nope' }],
      });
      const { deleteManyFromR2 } = await import('../r2');

      const result = await deleteManyFromR2(['k/1', 'k/2']);

      expect(result.deleted).toBe(1);
      expect(result.failedKeys).toEqual(['k/2']);
      expect(result.errors).toEqual(['k/2: AccessDenied nope']);
    });
  });

  describe('resolveOwnedAssetKey', () => {
    it('returns the key for a CDN URL under the seller/asset prefix', async () => {
      const { resolveOwnedAssetKey } = await import('../r2');

      expect(
        resolveOwnedAssetKey('https://cdn.test.com/assets/s1/a1/file/model.glb', 's1', 'a1')
      ).toBe('assets/s1/a1/file/model.glb');
    });

    it('accepts a CDN_URL configured with a scheme', async () => {
      process.env.CDN_URL = 'https://cdn.test.com';
      const { resolveOwnedAssetKey } = await import('../r2');

      expect(
        resolveOwnedAssetKey('https://cdn.test.com/assets/s1/a1/preview/t.png', 's1', 'a1')
      ).toBe('assets/s1/a1/preview/t.png');
    });

    it('rejects a key belonging to a different seller', async () => {
      const { resolveOwnedAssetKey } = await import('../r2');

      expect(
        resolveOwnedAssetKey('https://cdn.test.com/assets/victim/a9/file/paid.glb', 's1', 'a1')
      ).toBeNull();
    });

    it('rejects a key belonging to a different asset of the same seller', async () => {
      const { resolveOwnedAssetKey } = await import('../r2');

      expect(
        resolveOwnedAssetKey('https://cdn.test.com/assets/s1/a2/file/other.glb', 's1', 'a1')
      ).toBeNull();
    });

    it('rejects a prefix-lookalike seller id', async () => {
      const { resolveOwnedAssetKey } = await import('../r2');

      expect(
        resolveOwnedAssetKey('https://cdn.test.com/assets/s10/a1/file/x.glb', 's1', 'a1')
      ).toBeNull();
    });

    it('rejects a host that only looks like the CDN host', async () => {
      const { resolveOwnedAssetKey } = await import('../r2');

      expect(
        resolveOwnedAssetKey('https://evil-cdn.test.com/assets/s1/a1/file/x.glb', 's1', 'a1')
      ).toBeNull();
    });

    it('rejects unparsable, empty, and null URLs', async () => {
      const { resolveOwnedAssetKey } = await import('../r2');

      expect(resolveOwnedAssetKey('not a url', 's1', 'a1')).toBeNull();
      expect(resolveOwnedAssetKey('', 's1', 'a1')).toBeNull();
      expect(resolveOwnedAssetKey(null, 's1', 'a1')).toBeNull();
      expect(resolveOwnedAssetKey(undefined, 's1', 'a1')).toBeNull();
    });

    it('returns null when CDN_URL is not configured', async () => {
      delete process.env.CDN_URL;
      const { resolveOwnedAssetKey } = await import('../r2');

      expect(
        resolveOwnedAssetKey('https://cdn.test.com/assets/s1/a1/file/x.glb', 's1', 'a1')
      ).toBeNull();
    });
  });

  describe('existsInR2', () => {
    it('returns true when object exists', async () => {
      mockSend.mockResolvedValue({});
      const { existsInR2 } = await import('../r2');

      expect(await existsInR2('test/key.png')).toBe(true);
    });

    it('returns false when object does not exist (NotFound by name)', async () => {
      const notFoundError = new Error('NotFound');
      notFoundError.name = 'NotFound';
      mockSend.mockRejectedValue(notFoundError);
      const { existsInR2 } = await import('../r2');

      expect(await existsInR2('missing/key.png')).toBe(false);
    });

    it('returns false when object does not exist (404 metadata)', async () => {
      const notFoundError = Object.assign(new Error('not found'), {
        $metadata: { httpStatusCode: 404 },
      });
      mockSend.mockRejectedValue(notFoundError);
      const { existsInR2 } = await import('../r2');

      expect(await existsInR2('missing/key.png')).toBe(false);
    });

    it('rethrows non-NotFound errors', async () => {
      mockSend.mockRejectedValue(new Error('NetworkFailure'));
      const { existsInR2 } = await import('../r2');

      await expect(existsInR2('test/key.png')).rejects.toThrow('NetworkFailure');
    });
  });

  describe('getSignedDownloadUrl', () => {
    it('generates a signed URL', async () => {
      const { getSignedDownloadUrl } = await import('../r2');

      const url = await getSignedDownloadUrl('test/key.png');
      expect(url).toBe('https://signed-url.example.com/file');
    });
  });

  describe('error handling', () => {
    it('throws when R2 credentials are missing', async () => {
      delete process.env.ASSET_R2_ACCOUNT_ID;
      const { uploadToR2 } = await import('../r2');

      await expect(uploadToR2('key', Buffer.from(''), 'text/plain')).rejects.toThrow(
        'R2 storage not configured'
      );
    });

    it('throws when bucket name is missing', async () => {
      delete process.env.ASSET_BUCKET_NAME;
      const { uploadToR2 } = await import('../r2');

      await expect(uploadToR2('key', Buffer.from(''), 'text/plain')).rejects.toThrow(
        'ASSET_BUCKET_NAME not configured'
      );
    });
  });
});
