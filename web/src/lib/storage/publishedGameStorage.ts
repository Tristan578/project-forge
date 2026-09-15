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

/** Schema-v1 metadata identifying the Clerk publisher, slug, and immutable publication version. */
export type PublishedGameManifest = z.infer<typeof manifestSchema>;
/** Validated scene object and publication manifest; component validation remains the engine's responsibility. */
export type PublishedGameBundle = z.infer<typeof bundleSchema>;

/**
 * Check the snapshot object boundary independently of its engine format.
 *
 * @param value Untrusted snapshot value.
 * @returns Whether it is a JSON-style object; this check does not validate engine component schemas.
 */
export function isPublishedSceneData(value: unknown): value is PublishedGameBundle['sceneData'] {
  return sceneSchema.safeParse(value).success;
}

/** Generate a unique publication key; no later publication overwrites it.
 *
 * @param userId Clerk user identity containing only letters, digits, underscores, and hyphens.
 * @param slug Publication slug using the same permitted characters.
 * @returns A games/{ClerkID}/{slug}/{UUID}/bundle.json key with a fresh revision.
 * @throws If either identity segment is invalid.
 */
export function buildPublishedGameKey(userId: string, slug: string): string {
  if (!segment.safeParse(userId).success || !segment.safeParse(slug).success) {
    throw new Error('Published game bundle key rejected');
  }
  return `games/${userId}/${slug}/${randomUUID()}/bundle.json`;
}

/** Validate an exact stored key before reads or deletion; never trust a prefix alone.
 *
 * @param key Stored object key, or null/undefined when no R2 snapshot exists.
 * @param userId Expected Clerk identity, not the internal database UUID.
 * @param slug Expected publication slug.
 * @returns The exact key if its owner, slug, UUID revision, and filename match; otherwise null.
 */
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

/** Write a new private snapshot. Failed or uncertain uploads are cleaned up best effort.
 *
 * @param userId Publisher's Clerk identity, not the internal database UUID.
 * @param slug Publication slug used in both key and manifest.
 * @param sceneData Scene object retained as the publication snapshot.
 * @param manifest Schema-v1 metadata whose owner, slug, and positive publication version must match.
 * @returns The newly written immutable private object key; no public URL is produced.
 * @throws On validation or upload failure. Upload failures trigger best-effort candidate cleanup before rejection.
 */
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

/** Read the row's actual immutable key; invalid or mismatched data triggers fallback.
 *
 * @param key Exact immutable key stored on the publication row.
 * @param userId Expected publisher Clerk identity.
 * @param slug Expected publication slug.
 * @param version Expected positive publication version.
 * @returns A parsed bundle matching the requested owner, slug, and version.
 * @throws On key mismatch, invalid JSON/manifest, or storage failure; callers may use the saved Postgres snapshot.
 */
export async function readPublishedGameBundle(
  key: string, userId: string, slug: string, version: number,
): Promise<PublishedGameBundle> {
  if (!resolveOwnedPublishedGameKey(key, userId, slug)) {
    throw new Error('Published game bundle key rejected');
  }
  return validateBundle(JSON.parse(await getObjectFromR2(key)), userId, slug, version);
}

/** Best-effort cleanup after rollback, supersession, or account deletion. Never throws.
 *
 * @param key Optional object key from a failed, superseded, or deleted publication.
 * @param userId Expected publisher Clerk identity.
 * @param slug Expected publication slug.
 * @returns Resolves after best-effort object/sidecar cleanup. Invalid keys are ignored; storage failures are reported to monitoring without rejection.
 */
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
