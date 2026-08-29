import { describe, it, expect, vi } from 'vitest';

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    constructor(public args: unknown) {}
  },
  ListObjectsV2Command: class {
    constructor(public args: { Bucket: string; Prefix: string; ContinuationToken?: string }) {}
  },
}));

import {
  validatePrefix,
  listKeysUnderPrefix,
  readEnv,
  isMainModule,
  type ListCapableClient,
} from '../list-orphaned-r2-keys';

describe('list-orphaned-r2-keys', () => {
  describe('validatePrefix', () => {
    it('accepts a per-user prefix', () => {
      expect(validatePrefix('assets/user-1/')).toBe('assets/user-1/');
    });

    it('trims surrounding whitespace', () => {
      expect(validatePrefix('  assets/user-1/  ')).toBe('assets/user-1/');
    });

    it('rejects a missing prefix rather than listing the whole bucket', () => {
      expect(() => validatePrefix(undefined)).toThrow(/Usage:/);
      expect(() => validatePrefix('   ')).toThrow(/Usage:/);
    });

    it('rejects a prefix without a trailing slash', () => {
      // "assets/user-1" would also match "assets/user-10/...", reporting another
      // user's objects as this user's orphans.
      expect(() => validatePrefix('assets/user-1')).toThrow(/must end with/);
    });
  });

  describe('listKeysUnderPrefix', () => {
    it('follows continuation tokens instead of stopping at the first page', async () => {
      const sent: { Bucket: string; Prefix: string; ContinuationToken?: string }[] = [];
      const client: ListCapableClient = {
        send: vi.fn(async (command: unknown) => {
          const args = (command as { args: { Bucket: string; Prefix: string; ContinuationToken?: string } }).args;
          sent.push(args);
          if (!args.ContinuationToken) {
            return {
              Contents: [{ Key: 'assets/u1/a1/file/one.glb' }, { Key: 'assets/u1/a1/file/one.glb.status.json' }],
              IsTruncated: true,
              NextContinuationToken: 'page-2',
            };
          }
          return { Contents: [{ Key: 'assets/u1/a2/preview/two.png' }], IsTruncated: false };
        }),
      };

      const keys = await listKeysUnderPrefix(client, 'spawnforge-assets', 'assets/u1/');

      expect(keys).toEqual([
        'assets/u1/a1/file/one.glb',
        'assets/u1/a1/file/one.glb.status.json',
        'assets/u1/a2/preview/two.png',
      ]);
      expect(sent).toEqual([
        { Bucket: 'spawnforge-assets', Prefix: 'assets/u1/', ContinuationToken: undefined },
        { Bucket: 'spawnforge-assets', Prefix: 'assets/u1/', ContinuationToken: 'page-2' },
      ]);
    });

    it('stops when IsTruncated is false even if a token is echoed back', async () => {
      const client: ListCapableClient = {
        send: vi.fn(async () => ({
          Contents: [{ Key: 'assets/u1/a1/file/one.glb' }],
          IsTruncated: false,
          NextContinuationToken: 'stale-token',
        })),
      };

      const keys = await listKeysUnderPrefix(client, 'b', 'assets/u1/');

      expect(keys).toEqual(['assets/u1/a1/file/one.glb']);
      expect(client.send).toHaveBeenCalledTimes(1);
    });

    it('returns an empty list when the prefix holds nothing', async () => {
      const client: ListCapableClient = {
        send: vi.fn(async () => ({ IsTruncated: false })),
      };

      await expect(listKeysUnderPrefix(client, 'b', 'assets/u1/')).resolves.toEqual([]);
    });
  });

  describe('readEnv', () => {
    const full = {
      ASSET_R2_ACCOUNT_ID: 'acct',
      ASSET_R2_ACCESS_KEY_ID: 'key',
      ASSET_R2_SECRET_ACCESS_KEY: 'secret',
      ASSET_BUCKET_NAME: 'spawnforge-assets',
    };

    it('reads the same variable names the app uses', () => {
      expect(readEnv(full)).toEqual({
        accountId: 'acct',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        bucket: 'spawnforge-assets',
      });
    });

    it('names every missing variable rather than failing deep in the SDK', () => {
      expect(() => readEnv({ ASSET_R2_ACCOUNT_ID: 'acct' })).toThrow(
        /ASSET_R2_ACCESS_KEY_ID, ASSET_R2_SECRET_ACCESS_KEY, ASSET_BUCKET_NAME/
      );
    });
  });

  describe('isMainModule', () => {
    it('is false when there is no argv[1]', () => {
      expect(isMainModule('file:///x.ts', undefined)).toBe(false);
    });

    it('matches a platform-native argv path against the module URL', () => {
      const argv1 = '/tmp/list-orphaned-r2-keys.ts';
      expect(isMainModule('file:///tmp/list-orphaned-r2-keys.ts', argv1)).toBe(true);
      expect(isMainModule('file:///tmp/other.ts', argv1)).toBe(false);
    });
  });
});
