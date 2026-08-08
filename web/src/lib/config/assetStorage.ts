/**
 * Environment variables that configure Cloudflare R2 asset storage.
 *
 * `lib/storage/r2.ts` is the only code path that actually talks to R2, and it
 * is the reason these names exist. The health check reads the same constants
 * so it can never again grade a namespace nothing writes: before PF-1054 it
 * probed `CLOUDFLARE_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`
 * / `R2_BUCKET_NAME` — four names set in no environment and read by no other
 * module — and reported a permanent "Asset Storage: outage" on a status page
 * whose storage was working fine.
 */
export const ASSET_STORAGE_ENV = {
  accountId: 'ASSET_R2_ACCOUNT_ID',
  accessKeyId: 'ASSET_R2_ACCESS_KEY_ID',
  secretAccessKey: 'ASSET_R2_SECRET_ACCESS_KEY',
  bucketName: 'ASSET_BUCKET_NAME',
} as const;

export type AssetStorageEnvKey = keyof typeof ASSET_STORAGE_ENV;
