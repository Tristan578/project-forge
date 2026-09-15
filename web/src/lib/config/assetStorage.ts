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

/**
 * Feature flag: mirror published game bundles into R2 (object storage) on
 * publish and read them back on /play, falling back to Postgres-served
 * `sceneData` when R2 is absent or errors (#7580).
 *
 * DEFAULTS ON when `ASSET_BUCKET_NAME` is configured, off otherwise — so a
 * deploy that already has R2 credentials starts serving published games from
 * object storage without a second flag flip, while a deploy without a bucket
 * (local dev, preview without storage) stays on the existing Postgres path with
 * zero behaviour change. An explicit `PUBLISH_TO_R2=false` ALWAYS wins, so the
 * mirror can be killed on a configured deploy without pulling the bucket env;
 * an explicit `PUBLISH_TO_R2=true` forces it on even before a bucket is wired
 * (the write then fails open — see the publish route).
 *
 * Comparison is exact against the trimmed, lower-cased value: any string other
 * than 'true' / 'false' (a typo, an empty string) is treated as "unset" and
 * falls through to the bucket-presence default, never as an accidental enable.
 */
export function isPublishToR2Enabled(): boolean {
  const raw = (process.env.PUBLISH_TO_R2 ?? '').trim().toLowerCase();
  if (raw === 'false') return false;
  if (raw === 'true') return true;
  return Boolean(process.env[ASSET_STORAGE_ENV.bucketName]);
}
