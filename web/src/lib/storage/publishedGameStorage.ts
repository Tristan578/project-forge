/**
 * Private, immutable publication snapshots. Only the gated play API reads these
 * objects; the assets bucket must remain private. Postgres retains the same
 * snapshot so storage outages do not reveal subsequent unpublished edits.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  putPrivateObjectToR2, getObjectFromR2, deleteManyFromR2, withStatusSidecars,
} from '@/lib/storage/r2';
import { captureException } from '@/lib/monitoring/sentry-server';

const segment = z.string().regex(/^[a-zA-Z0-9_-]+$/);
const revision = z.string().uuid();
const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.number().int().positive(),
  publishedAt: z.string().datetime(),
  slug: segment,
  userId: segment,
}).strict();

// Scene formats vary by engine/template version; this boundary requires a JSON
// object and leaves component-level validation to the scene loader.
const sceneSchema = z.record(z.string(), z.unknown());
const bundleSchema = z.object({
  sceneData: sceneSchema,
  manifest: manifestSchema,
}).strict();

export type PublishedGameManifest = z.infer<typeof manifestSchema>;
export type PublishedGameBundle = z.infer<typeof bundleSchema>;

export function isPublishedSceneData(value: unknown): value is PublishedGameBundle['sceneData'] {
  return sceneSchema.safeParse(value).success;
}

/** Generate a unique publication key; no later publication overwrites it. */
export function buildPublishedGameKey(userId: string, slug: string): string {
  if (!segment.safeParse(userId).success || !segment.safeParse(slug).success) {
    throw new Error('Published game bundle key rejected');
  }
  return `games/${userId}/${slug}/${randomUUID()}/bundle.json`;
}

/** Validate an exact stored key before reads or deletion; never trust a prefix alone. */
export function resolveOwnedPublishedGameKey(
  key: string | null | undefined, userId: string, slug: string,
): string | null {
  if (!key || !segment.safeParse(userId).success || !segment.safeParse(slug).success) return null;
  const parts = key.split('/');
  return parts.length === 5 && parts[0] === 'games' && parts[1] === userId &&
    parts[2] === slug && revision.safeParse(parts[3]).success && parts[4] === 'bundle.json'
    ? key : null;
}

/** Validate identity and version as well as structure before accepting a bundle. */
function validateBundle(
  data: unknown, userId: string, slug: string, version: number,
): PublishedGameBundle {
  const bundle = bundleSchema.parse(data);
  if (bundle.manifest.userId !== userId || bundle.manifest.slug !== slug ||
      bundle.manifest.version !== version) {
    throw new Error('Published game bundle does not match the publication');
  }
  return bundle;
}

/** Write a new private snapshot. Failed or uncertain uploads are cleaned up best effort. */
export async function writePublishedGameBundle(
  userId: string, slug: string, sceneData: unknown,
  manifest: PublishedGameManifest,
): Promise<{ key: string }> {
  const key = buildPublishedGameKey(userId, slug);
  const bundle = validateBundle({ sceneData, manifest }, userId, slug, manifest.version);
  try {
    await putPrivateObjectToR2(key, Buffer.from(JSON.stringify(bundle), 'utf-8'), 'application/json');
    return { key };
  } catch (error) {
    captureException(error, { scope: 'publishedGameStorage.write', key, userId, slug });
    await deletePublishedGameBundle(key, userId, slug);
    throw error;
  }
}

/** Read the row's actual immutable key; invalid or mismatched data triggers fallback. */
export async function readPublishedGameBundle(
  key: string, userId: string, slug: string, version: number,
): Promise<PublishedGameBundle> {
  if (!resolveOwnedPublishedGameKey(key, userId, slug)) {
    throw new Error('Published game bundle key rejected');
  }
  return validateBundle(JSON.parse(await getObjectFromR2(key)), userId, slug, version);
}

/** Best-effort cleanup after rollback, supersession, or account deletion. Never throws. */
export async function deletePublishedGameBundle(
  key: string | null | undefined, userId: string, slug: string,
): Promise<void> {
  const ownedKey = resolveOwnedPublishedGameKey(key, userId, slug);
  if (!ownedKey) return;
  try {
    const result = await deleteManyFromR2(withStatusSidecars([ownedKey]));
    if (result.failedKeys.length || result.truncated) {
      captureException(new Error('Published game object cleanup incomplete'), {
        scope: 'publishedGameStorage.cleanup', userId, slug, key: ownedKey,
        failedKeys: result.failedKeys,
      });
    }
  } catch (error) {
    captureException(error, { scope: 'publishedGameStorage.cleanup', userId, slug, key: ownedKey });
  }
}
