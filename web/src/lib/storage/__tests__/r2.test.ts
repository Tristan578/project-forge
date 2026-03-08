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

  describe('deleteFromR2', () => {
    it('sends delete command', async () => {
      mockSend.mockResolvedValue({});
      const { deleteFromR2 } = await import('../r2');

      await deleteFromR2('test/key.png');
      expect(mockSend).toHaveBeenCalledTimes(1);
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
