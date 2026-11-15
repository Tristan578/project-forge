/**
 * Commit publication metadata, the immutable Postgres scene snapshot, and tags
 * in one non-interactive SQL statement. Object upload/cleanup is owned by callers.
 */
import { getNeonSql, queryWithResilience } from '@/lib/db/client';

/** Validated write input. Database identities are UUIDs; bundleKey carries the separate Clerk-owned R2 key. */
export interface PublicationCommit {
  userId: string;
  projectId: string;
  slug: string;
  title: string;
  description: string | null;
  thumbnail: string | null;
  gameUrl: string;
  /** Zero for a new slug; otherwise the version observed before uploading the candidate. */
  expectedVersion: number;
  bundleKey: string | null;
  sceneData: unknown;
  tags: string[];
}

/** Public response metadata from the committed row; omits the scene snapshot and private R2 key. */
export interface CommittedPublication {
  id: string;
  userId: string;
  projectId: string;
  slug: string;
  title: string;
  description: string | null;
  status: string;
  version: number;
  cdnUrl: string;
  thumbnail: string | null;
}

/**
 * Atomically replace publication metadata, its fallback snapshot, and tags.
 * An optimistic version guard makes a concurrent loser return no row instead
 * of overwriting the winner or publishing a bundle with the wrong version.
 * This single SQL statement works with neon-http's non-interactive driver.
 *
 * @param input Validated publication data; userId/projectId are internal database UUIDs. expectedVersion is zero for creation or the observed version for an update.
 * @returns Committed publication metadata, or null when the version/moderation guard prevents a write.
 * @throws On serialization or database failure. The statement is attempted once: a lost response may follow a commit, so callers must reconcile storage references before cleanup.
 */
export async function commitPublication(input: PublicationCommit): Promise<CommittedPublication | null> {
  const query = getNeonSql();
  const rows = await queryWithResilience(() => query`
    WITH publication AS (
      INSERT INTO published_games
        (user_id, project_id, slug, title, description, status, version,
         cdn_url, cdn_bundle_key, published_scene_data, thumbnail)
      SELECT ${input.userId}::uuid, ${input.projectId}::uuid, ${input.slug},
        ${input.title}, ${input.description}, 'published'::publish_status,
        ${input.expectedVersion + 1}, ${input.gameUrl}, ${input.bundleKey},
        ${JSON.stringify(input.sceneData)}::jsonb, ${input.thumbnail}
      WHERE NOT EXISTS (
        SELECT 1 FROM published_games
        WHERE user_id = ${input.userId}::uuid
          AND project_id = ${input.projectId}::uuid AND flagged_at IS NOT NULL
      ) AND (
        ${input.expectedVersion} = 0 OR EXISTS (
          SELECT 1 FROM published_games
          WHERE user_id = ${input.userId}::uuid AND slug = ${input.slug}
            AND version = ${input.expectedVersion}
        )
      )
      ON CONFLICT (user_id, slug) DO UPDATE SET
        project_id = EXCLUDED.project_id, title = EXCLUDED.title,
        description = EXCLUDED.description, status = EXCLUDED.status,
        version = EXCLUDED.version, cdn_url = EXCLUDED.cdn_url,
        cdn_bundle_key = EXCLUDED.cdn_bundle_key,
        published_scene_data = EXCLUDED.published_scene_data,
        thumbnail = EXCLUDED.thumbnail, updated_at = now()
      WHERE published_games.version = ${input.expectedVersion}
        AND published_games.flagged_at IS NULL
      RETURNING *
    ), removed_tags AS (
      DELETE FROM game_tags WHERE game_id IN (SELECT id FROM publication)
      RETURNING id
    ), added_tags AS (
      INSERT INTO game_tags (game_id, tag)
      SELECT publication.id, tag
      FROM publication CROSS JOIN jsonb_array_elements_text(${JSON.stringify(input.tags)}::jsonb) AS tag
      WHERE (SELECT count(*) FROM removed_tags) >= 0
      RETURNING id
    )
    SELECT jsonb_build_object(
      'id', id, 'userId', user_id, 'projectId', project_id, 'slug', slug,
      'title', title, 'description', description, 'status', status,
      'version', version, 'cdnUrl', cdn_url, 'thumbnail', thumbnail
    ) AS publication, (SELECT count(*) FROM added_tags) AS tag_count
    FROM publication
  `, { maxAttempts: 1 });
  return (rows[0]?.publication as CommittedPublication | undefined) ?? null;
}
