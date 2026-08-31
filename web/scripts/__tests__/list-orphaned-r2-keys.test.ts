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

    // Both shapes are spelled out literally rather than derived with
    // pathToFileURL, which would just restate the implementation. The case name
    // has always said 'platform-native', but the fixture was POSIX-only: on
    // Windows process.argv[1] is 'D:\\script.ts' while import.meta.url is
    // 'file:///D:/script.ts', so the real question is whether those two match.
    const native =
      process.platform === 'win32'
        ? {
            argv: 'D:\\tmp\\list-orphaned-r2-keys.ts',
            url: 'file:///D:/tmp/list-orphaned-r2-keys.ts',
            other: 'file:///D:/tmp/other.ts',
          }
        : {
            argv: '/tmp/list-orphaned-r2-keys.ts',
            url: 'file:///tmp/list-orphaned-r2-keys.ts',
            other: 'file:///tmp/other.ts',
          };

    it('matches a platform-native argv path against the module URL', () => {
      expect(isMainModule(native.url, native.argv)).toBe(true);
      expect(isMainModule(native.other, native.argv)).toBe(false);
    });

    // runIf, not an early `return`: an early return reports as a PASS on Linux,
    // which claims coverage this case cannot give there. The drive letter is
    // part of the identity -- without it a script at /tmp/x.ts and one at
    // D:/tmp/x.ts would be indistinguishable -- but only Windows argv carries
    // one, so the assertion is honestly Windows-only.
    it.runIf(process.platform === 'win32')(
      'does not treat a POSIX-shaped URL as this module on Windows',
      () => {
        expect(isMainModule('file:///tmp/list-orphaned-r2-keys.ts', native.argv)).toBe(false);
      }
    );
  });
});
