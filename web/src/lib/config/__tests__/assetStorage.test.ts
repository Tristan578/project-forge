import { describe, it, expect, afterEach } from 'vitest';
import { isPublishToR2Enabled, ASSET_STORAGE_ENV } from '../assetStorage';

const FLAG = 'PUBLISH_TO_R2';
const BUCKET = ASSET_STORAGE_ENV.bucketName;

describe('isPublishToR2Enabled', () => {
  afterEach(() => {
    delete process.env[FLAG];
    delete process.env[BUCKET];
  });

  it('defaults ON when ASSET_BUCKET_NAME is set and the flag is unset', () => {
    process.env[BUCKET] = 'spawnforge-games';
    expect(isPublishToR2Enabled()).toBe(true);
  });

  it('defaults OFF when ASSET_BUCKET_NAME is unset and the flag is unset', () => {
    expect(isPublishToR2Enabled()).toBe(false);
  });

  it('explicit "false" wins even when ASSET_BUCKET_NAME is set', () => {
    process.env[BUCKET] = 'spawnforge-games';
    process.env[FLAG] = 'false';
    expect(isPublishToR2Enabled()).toBe(false);
  });

  it('explicit "true" wins even when ASSET_BUCKET_NAME is unset', () => {
    process.env[FLAG] = 'true';
    expect(isPublishToR2Enabled()).toBe(true);
  });

  it('is case- and whitespace-insensitive for the explicit values', () => {
    process.env[FLAG] = '  TRUE  ';
    expect(isPublishToR2Enabled()).toBe(true);
    process.env[FLAG] = 'False';
    process.env[BUCKET] = 'spawnforge-games';
    expect(isPublishToR2Enabled()).toBe(false);
  });

  it('treats any other value as unset (falls through to the bucket default)', () => {
    process.env[FLAG] = 'yes';
    expect(isPublishToR2Enabled()).toBe(false);
    process.env[BUCKET] = 'spawnforge-games';
    expect(isPublishToR2Enabled()).toBe(true);
  });
});
