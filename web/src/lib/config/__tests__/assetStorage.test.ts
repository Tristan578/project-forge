import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isPublishToR2Enabled, ASSET_STORAGE_ENV } from '../assetStorage';

const FLAG = 'PUBLISH_TO_R2';
const BUCKET = ASSET_STORAGE_ENV.bucketName;

describe('isPublishToR2Enabled', () => {
  beforeEach(() => {
    vi.stubEnv(FLAG, undefined);
    vi.stubEnv(BUCKET, undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('defaults ON when ASSET_BUCKET_NAME is set and the flag is unset', () => {
    vi.stubEnv(BUCKET, 'spawnforge-games');
    expect(isPublishToR2Enabled()).toBe(true);
  });

  it('defaults OFF when ASSET_BUCKET_NAME is unset and the flag is unset', () => {
    expect(isPublishToR2Enabled()).toBe(false);
  });

  it('explicit "false" wins even when ASSET_BUCKET_NAME is set', () => {
    vi.stubEnv(BUCKET, 'spawnforge-games');
    vi.stubEnv(FLAG, 'false');
    expect(isPublishToR2Enabled()).toBe(false);
  });

  it('explicit "true" wins even when ASSET_BUCKET_NAME is unset', () => {
    vi.stubEnv(FLAG, 'true');
    expect(isPublishToR2Enabled()).toBe(true);
  });

  it('is case- and whitespace-insensitive for the explicit values', () => {
    vi.stubEnv(FLAG, '  TRUE  ');
    expect(isPublishToR2Enabled()).toBe(true);
    vi.stubEnv(FLAG, 'False');
    vi.stubEnv(BUCKET, 'spawnforge-games');
    expect(isPublishToR2Enabled()).toBe(false);
  });

  it('treats any other value as unset (falls through to the bucket default)', () => {
    vi.stubEnv(FLAG, 'yes');
    expect(isPublishToR2Enabled()).toBe(false);
    vi.stubEnv(BUCKET, 'spawnforge-games');
    expect(isPublishToR2Enabled()).toBe(true);
  });
});
