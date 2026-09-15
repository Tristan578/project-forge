/**
 * Published-game bundle storage (#7580).
 *
 * On publish we mirror a game's scene data into R2 as a single JSON bundle so
 * the player page can be served from CDN-backed object storage instead of a
 * live Postgres read. The bundle is deliberately self-describing — it carries a
 * manifest alongside the scene data — so a bundle read back later can be
 * validated without a second DB round trip.
 *
 * This module is the ONLY producer/consumer of the `games/{userId}/{slug}/`
 * key space. It is intentionally separate from `buildAssetKey` in `r2.ts`
 * (which owns the `assets/{sellerId}/...` marketplace space) so the two key
 * schemes can never collide and neither route can address the other's objects.
 *
 * VERSIONED KEYS (#7580 review round 2): every publish version gets its OWN
 * immutable object at `games/{userId}/{slug}/v{version}/bundle.json`. Nothing is
 * ever overwritten in place, so a republish can never mutate the bytes a
 * still-committed row points at, and two concurrent writes can never clobber
 * each other's content. The read path derives the key from the DB row's OWN
 * `version`, so it can only ever fetch the object that matches the version the
 * database claims: a bundle written by a later, not-yet-committed (or failed)
 * republish lives at a different key and is invisible to the read. As a second
 * wall the read re-checks the manifest's version/slug/userId against what was
 * requested and rejects any mismatch as stale.
 *
 * FAIL-OPEN CONTRACT: `writePublishedGameBundle` may throw (R2 unconfigured,
 * network) and `readPublishedGameBundle` may throw (missing object, malformed
 * JSON, or a manifest that does not match the requested publication version).
 * Callers on the publish and play paths catch and fall back to Postgres;
 * object storage is a cache in front of the database, never the source of
 * truth. See `src/app/api/publish/route.ts` and
 * `src/app/api/play/[userId]/[slug]/route.ts`.
 */
import { uploadToR2, getObjectFromR2 } from '@/lib/storage/r2';

/** Manifest embedded in every published-game bundle. */
export interface PublishedGameManifest {
  /** Publication version — matches `published_games.version` at write time. */
  version: number;
  /** ISO-8601 timestamp the bundle was written. */
  publishedAt: string;
  /** The game's slug (redundant with the key; lets a bundle self-verify). */
  slug: string;
  /** The creator's public id (Clerk id) used in the /play URL and the key. */
  userId: string;
}

/** Shape stored at `games/{userId}/{slug}/v{version}/bundle.json`. */
export interface PublishedGameBundle {
  sceneData: unknown;
  manifest: PublishedGameManifest;
}

/**
 * Reject a userId or slug segment that could escape the intended prefix or
 * introduce encoding ambiguity, BEFORE it ever reaches an R2 key.
 *
 * Forbidden: `/` and `\` (path separators), `%` (percent-encoding ambiguity),
 * the `..` sequence (traversal), and any C0/DEL control character. The publish
 * route already constrains slugs to `[a-z0-9-]` and Clerk ids are opaque
 * alphanumerics, so this is defence in depth — a second wall so a future caller
 * that forgets the route-level validation cannot mint a traversing key.
 *
 * Implemented as a codepoint scan rather than a regex literal so it carries no
 * fragile inline control-character escapes.
 */
function assertSafeSegment(label: string, value: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Published game bundle key rejected: ${label} is empty`);
  }
  if (value.includes('..')) {
    throw new Error(
      `Published game bundle key rejected: ${label} contains an unsafe character`,
    );
  }
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    const ch = value[i];
    const isControl = code < 0x20 || code === 0x7f;
    if (isControl || ch === '/' || ch === '\\' || ch === '%') {
      throw new Error(
        `Published game bundle key rejected: ${label} contains an unsafe character`,
      );
    }
  }
}

/**
 * Reject a version that is not a positive integer BEFORE it becomes a key
 * segment. Publication versions start at 1 and only ever increment, so anything
 * non-integer, zero, negative, or non-finite is a programming error, not a key
 * we should mint (a `v{NaN}` / `vundefined` segment would silently split the
 * key space and orphan objects).
 */
function assertSafeVersion(version: number): void {
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error(
      'Published game bundle key rejected: version must be a positive integer',
    );
  }
}

/**
 * Deterministic R2 key for a specific version of a published game's bundle:
 * `games/{userId}/{slug}/v{version}/bundle.json`.
 *
 * The `v{version}` segment is what makes each publication immutable: a
 * republish writes a NEW object at a NEW key rather than overwriting the live
 * one, so a failed or racing write can never corrupt the bytes an
 * already-committed row points at (#7580 review round 2).
 *
 * Rejects any userId/slug that could escape the prefix or introduce encoding
 * ambiguity, and any non-positive-integer version, BEFORE returning a key (and
 * therefore before any R2 call).
 */
export function buildPublishedGameKey(
  userId: string,
  slug: string,
  version: number,
): string {
  assertSafeSegment('userId', userId);
  assertSafeSegment('slug', slug);
  assertSafeVersion(version);
  return `games/${userId}/${slug}/v${version}/bundle.json`;
}

/**
 * Write a published game's bundle to R2 under its version-specific key. Returns
 * the object key and the public CDN URL (the latter only exists when `CDN_URL`
 * is configured — `uploadToR2` throws otherwise, which the publish route treats
 * as "mirror unavailable").
 *
 * The key is derived from `manifest.version`, so the object and the version it
 * declares can never disagree.
 *
 * Throws on unsafe key input (before any R2 call) and on any R2/upload failure.
 */
export async function writePublishedGameBundle(
  userId: string,
  slug: string,
  sceneData: unknown,
  manifest: PublishedGameManifest,
): Promise<{ key: string; url: string }> {
  const key = buildPublishedGameKey(userId, slug, manifest.version);
  const bundle: PublishedGameBundle = { sceneData, manifest };
  const body = Buffer.from(JSON.stringify(bundle), 'utf-8');
  return uploadToR2(key, body, 'application/json');
}

/**
 * Read a specific version of a published game's bundle back from R2.
 *
 * The caller passes the DB row's OWN `version`, so the key derived here can only
 * address the object for the version the database currently claims — a bundle
 * written by a later, uncommitted, or failed republish lives at a different key
 * and is never returned. As a second wall the manifest is re-checked against the
 * requested version/slug/userId.
 *
 * Throws when the object is missing, the read fails, the payload is not valid
 * JSON, the parsed payload is not a well-formed bundle (no `sceneData`), or the
 * manifest does not match the requested publication (version/slug/userId). Every
 * throw is the fall-back signal for the play route — a missing OR stale OR
 * malformed bundle must never be served as if it were the current scene data.
 */
export async function readPublishedGameBundle(
  userId: string,
  slug: string,
  version: number,
): Promise<PublishedGameBundle> {
  const key = buildPublishedGameKey(userId, slug, version);
  const raw = await getObjectFromR2(key);
  const parsed = JSON.parse(raw) as Partial<PublishedGameBundle>;
  if (parsed === null || typeof parsed !== 'object' || !('sceneData' in parsed)) {
    throw new Error(`Published game bundle at ${key} is malformed (no sceneData)`);
  }
  const manifest = (parsed as PublishedGameBundle).manifest;
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    manifest.version !== version ||
    manifest.slug !== slug ||
    manifest.userId !== userId
  ) {
    throw new Error(
      `Published game bundle at ${key} does not match the requested publication ` +
        '(version/slug/userId mismatch) — treating as stale',
    );
  }
  return parsed as PublishedGameBundle;
}
