/**
 * Reconciliation helper for orphaned Cloudflare R2 objects (PF-9457).
 *
 * Account deletion and marketplace re-upload sweep R2 on a best-effort basis:
 * a storage failure is logged and reported to Sentry but never fails the
 * user-facing operation, and the asset read is capped so a pathological seller
 * cannot turn deletion into an unbounded loop. Both paths therefore need a way
 * to enumerate what is still sitting under a prefix afterwards. This is it.
 *
 * NOT run by any build, deploy, or agent — an operator runs it by hand.
 *
 * Why not wrangler: `wrangler r2 object` has exactly three subcommands (get,
 * put, delete) and there is no object-listing command anywhere under
 * `wrangler r2`. R2's S3-compatible API does have ListObjectsV2, and the web
 * app already talks to R2 through `@aws-sdk/client-s3` with the same
 * ASSET_R2_* credentials, so this script reuses that path.
 *
 * Usage:
 *   ASSET_R2_ACCOUNT_ID=... ASSET_R2_ACCESS_KEY_ID=... \
 *   ASSET_R2_SECRET_ACCESS_KEY=... ASSET_BUCKET_NAME=spawnforge-assets \
 *   node web/scripts/list-orphaned-r2-keys.ts "assets/<userId>/"
 *
 * Keys are printed one per line on stdout (a count goes to stderr) so the
 * output pipes straight into the delete half of the procedure:
 *
 *   ... | while read -r key; do
 *     npx wrangler r2 object delete "spawnforge-assets/$key" --remote
 *   done
 *
 * Runs under plain `node` (no tsx/ts-node) via Node's built-in TypeScript
 * type-stripping — Node 24+ only. That is why the config import below is a
 * relative path carrying an explicit `.ts` extension: bare type-stripping does
 * not consult tsconfig.json path mappings (so `@/` would not resolve), and
 * Node's ESM resolver does not append extensions to relative specifiers.
 */

import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { pathToFileURL } from 'node:url';
import { ASSET_STORAGE_ENV } from '../src/lib/config/assetStorage.ts';

/**
 * Guard against listing the whole bucket by accident.
 *
 * An empty prefix would enumerate every seller's objects, which is both a slow
 * mistake and the wrong shape of output for a per-user reconciliation. Requiring
 * a trailing slash also stops `assets/user-1` from matching `assets/user-10/…`,
 * which would report another user's objects as this user's orphans.
 */
export function validatePrefix(prefix: string | undefined): string {
  if (!prefix || prefix.trim().length === 0) {
    throw new Error(
      'Usage: node web/scripts/list-orphaned-r2-keys.ts "assets/<userId>/"'
    );
  }
  const trimmed = prefix.trim();
  if (!trimmed.endsWith('/')) {
    throw new Error(
      `Prefix must end with "/" so it cannot match a sibling key: got "${trimmed}"`
    );
  }
  return trimmed;
}

/** Minimal surface of the S3 client this script needs, so tests can stub it. */
export interface ListCapableClient {
  send(command: unknown): Promise<{
    Contents?: { Key?: string }[];
    NextContinuationToken?: string;
    IsTruncated?: boolean;
  }>;
}

/**
 * Every key under `prefix`, following ListObjectsV2 continuation tokens.
 *
 * ListObjectsV2 returns at most 1000 keys per call, so a single unpaginated
 * request would silently under-report exactly the accounts big enough for the
 * sweep's own caps to have bitten — the ones this script exists to inspect.
 */
export async function listKeysUnderPrefix(
  client: ListCapableClient,
  bucket: string,
  prefix: string
): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    for (const object of response.Contents ?? []) {
      if (object.Key) keys.push(object.Key);
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

/**
 * Read the R2 credentials this script needs, failing loudly if any is unset.
 *
 * Typed as a plain string dictionary rather than `NodeJS.ProcessEnv`: the app's
 * ambient declarations make `NODE_ENV` required on that type, which would force
 * every caller (tests included) to supply an unrelated variable.
 */
export function readEnv(env: Record<string, string | undefined>): {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
} {
  const missing = [
    ASSET_STORAGE_ENV.accountId,
    ASSET_STORAGE_ENV.accessKeyId,
    ASSET_STORAGE_ENV.secretAccessKey,
    ASSET_STORAGE_ENV.bucketName,
  ].filter((name) => !env[name]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  return {
    accountId: env[ASSET_STORAGE_ENV.accountId] as string,
    accessKeyId: env[ASSET_STORAGE_ENV.accessKeyId] as string,
    secretAccessKey: env[ASSET_STORAGE_ENV.secretAccessKey] as string,
    bucket: env[ASSET_STORAGE_ENV.bucketName] as string,
  };
}

async function main(): Promise<void> {
  const prefix = validatePrefix(process.argv[2]);
  const { accountId, accessKeyId, secretAccessKey, bucket } = readEnv(process.env);

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const keys = await listKeysUnderPrefix(client as unknown as ListCapableClient, bucket, prefix);
  for (const key of keys) console.log(key);
  console.error(`${keys.length} object(s) under ${prefix} in ${bucket}`);
}

/**
 * True when this module is the process entry point.
 * Uses pathToFileURL so the comparison also holds on Windows, where argv[1] is
 * a backslash drive path that never equals the file:// form of import.meta.url.
 */
export function isMainModule(metaUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  return metaUrl === pathToFileURL(argv1).href;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
