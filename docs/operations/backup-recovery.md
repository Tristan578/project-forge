# Backup & Recovery Strategy

> **Last updated:** 2026-03-16

## Database: Neon PostgreSQL

### Automated Backups

Neon provides continuous, automated backups with point-in-time recovery (PITR).

| Parameter | Value |
|-----------|-------|
| **Backup method** | Neon WAL-based continuous backup |
| **Retention period** | 7 days (default plan) |
| **Recovery granularity** | Any point within retention window |
| **RPO (Recovery Point Objective)** | < 1 hour |
| **RTO (Recovery Time Objective)** | < 4 hours |
| **Manual intervention required** | No (backups are automatic) |

### Point-in-Time Recovery (PITR)

Neon branching allows restoring to any point within the retention window by creating a new branch from a historical point.

**Steps to recover:**
1. Go to Neon Console (https://console.neon.tech)
2. Select the SpawnForge project
3. Go to Branches > Create Branch
4. Select "From a point in time" and choose the target timestamp
5. A new branch is created with the database state at that timestamp
6. Verify data integrity on the new branch
7. Update `DATABASE_URL` in Vercel to point to the recovery branch
8. Redeploy the application

### Recovery Scenarios

#### Accidental Data Deletion
1. Identify the timestamp just before the deletion
2. Create a Neon branch from that timestamp
3. Query the branch to extract the deleted data
4. Insert the recovered data back into the production branch
5. Drop the recovery branch after verification

#### Schema Migration Failure
1. Create a Neon branch from before the migration ran
2. Verify the pre-migration state is correct
3. Either fix the migration and re-run, or promote the recovery branch
4. Update connection string if promoting recovery branch

#### Full Database Corruption (Unlikely)
1. Create branch from the latest clean point within the 7-day window
2. Promote the recovery branch to production
3. Update `DATABASE_URL` in Vercel
4. Redeploy all services
5. Audit for any data created between corruption and recovery (RPO gap)

## Asset Storage: Cloudflare R2

### Engine WASM Files
- **Bucket:** `spawnforge-engine`
- **Backup strategy:** WASM files are build artifacts, reproducible from source code
- **Recovery:** Rebuild from source using `build_wasm.ps1` and redeploy with `/deploy-engine` skill
- **RTO:** < 30 minutes (rebuild + upload)

### User Assets
- **Bucket:** `spawnforge-assets`
- **Backup strategy:** R2 provides 99.999999999% (11 9s) annual durability
- **Cross-region replication:** Not currently configured (evaluate if user base grows)
- **Recovery:** R2 built-in durability is sufficient for current scale

## Application State

### Vercel Deployments
- Every deployment is immutable and retained
- Rollback to any previous deployment via Vercel dashboard
- No backup needed -- deployment history is the backup

### Environment Variables
- Stored in Vercel dashboard (encrypted at rest)
- Document all required env vars in a secure location (1Password, etc.)
- Keep a record of which services provide which keys

## Recovery Testing Schedule

| Test | Frequency | Procedure |
|------|-----------|-----------|
| PITR branch creation | Monthly (automated, `pitr-verify.yml`) | Create a Neon branch from the oldest point still inside the plan's PITR retention window (6h today), verify data integrity, drop branch |
| WASM rebuild from source | Quarterly | Run `build_wasm.ps1`, verify all 4 variants build successfully |
| Vercel rollback | Quarterly | Promote a previous deployment, verify functionality, re-promote current |
| Full DR drill | Annually | Simulate complete DB failure, execute PITR, verify RTO < 4 hours |

## Monitoring Backup Health

- **Neon:** Check branch creation capability monthly (free operation)
- **R2:** Monitor via Cloudflare dashboard for storage errors
- **Vercel:** Verify deployment history is accessible

## Compliance Notes

### GDPR Data Export
- Users can request a full export of their personal data via `GET /api/user/export-data`
- Export includes: profile, projects, billing history, token usage, published games, feedback
- See the endpoint implementation for the complete list of exported tables

### Data Retention
- User data: Retained until account deletion or explicit request
- Token usage logs: Retained for billing audit purposes (7 years recommended)
- Generation job records: Retained indefinitely (anonymized after account deletion)
- Webhook idempotency records: Auto-expire (TTL set at creation)

### Right to Erasure
- Account deletion endpoint: `DELETE /api/user/delete`
- Cascading deletes configured via foreign key constraints
- Published games are unpublished and removed on account deletion

#### Object storage (Cloudflare R2)

The `spawnforge-assets` bucket holds two kinds of user-keyed object:

1. Marketplace asset files and their previews, written by
   `POST /api/marketplace/seller/assets/[id]/upload` under the key
   `assets/{sellerId}/{assetId}/{file|preview}/{filename}`.
2. A `<key>.status.json` validation sidecar per object, written back by the
   asset post-processing Worker (`infra/asset-postprocess/worker.mjs`). Its R2
   event-notification source is registered bucket-wide with no prefix filter, so
   marketplace uploads produce sidecars too. Sidecars sit under the same
   `assets/{sellerId}/{assetId}/` prefix and are recorded in **no** Postgres
   row — a sweep driven off DB rows has to derive their keys, which both sweeps
   below do.

Published-game thumbnails are data URLs stored in Postgres, not R2 objects.

- **Timeline.** Objects are deleted synchronously, immediately after the account
  deletion transaction commits — not on a nightly job. `deleteUserAccount`
  (`web/src/lib/auth/user-service.ts`) reads the seller's asset URLs before the
  transaction, then sweeps the resolved keys with `deleteManyFromR2`.
- **Scope.** Only keys under the departing user's own
  `assets/{userId}/{assetId}/` prefix are removed. `previewUrl` /
  `assetFileUrl` are seller-writable through the asset PATCH route, so a stored
  URL pointing anywhere else is ignored rather than deleted.
- **Best-effort by design.** A storage failure never fails the deletion: the
  user's rows are already gone and there is nothing useful to retry. Failures
  are logged and reported to Sentry with the affected keys.
- **Caps.** One cap can leave work behind in practice: the marketplace-asset
  read stops at 1250 rows (`MAX_R2_SWEEP_KEYS / R2_KEYS_PER_ASSET`, i.e. 5000
  keys / 4 keys per asset — a preview and a file object, each with its sidecar).
  A seller past that limit gets a `console.error` and a Sentry `captureMessage`
  reading "Account deletion read only the first 1250 marketplace assets for user
  <id>", naming the `assets/{userId}/` prefix to reconcile. The read asks for
  1251 rows so it can tell "exactly at the cap" (nothing lost, stays quiet) from
  "past the cap" (reports). `deleteManyFromR2` carries its own 5000-key ceiling
  and its own "truncated" report; the row cap is sized so account deletion
  cannot reach it, and that branch exists only so a future change to the key
  shape degrades to a loud report rather than a silent drop.
- **Reconciliation.** Every orphan is enumerable by its `assets/{userId}/`
  prefix. There is no object-listing command in `wrangler` — `wrangler r2 object`
  offers only `get`, `put`, and `delete` — so listing goes through R2's
  S3-compatible `ListObjectsV2` API, which is what the app itself uses. Run:

  ```bash
  ASSET_R2_ACCOUNT_ID=... ASSET_R2_ACCESS_KEY_ID=... \
  ASSET_R2_SECRET_ACCESS_KEY=... ASSET_BUCKET_NAME=spawnforge-assets \
  node web/scripts/list-orphaned-r2-keys.ts "assets/<userId>/"
  ```

  It prints one key per line on stdout (a count on stderr) and follows
  continuation tokens, so it does not stop at the 1000-key page limit. Credentials
  are the same four `ASSET_R2_*` / `ASSET_BUCKET_NAME` variables the app reads
  (`web/src/lib/config/assetStorage.ts`); pull them with `vercel env pull`. The
  script requires Node 24+ (it runs under Node's built-in TypeScript
  type-stripping, no tsx needed). Delete what it lists with:

  ```bash
  npx wrangler r2 object delete "spawnforge-assets/<key>" --remote
  ```

  Remember each object's `<key>.status.json` sidecar if you are deleting by hand;
  the script lists sidecars too, so piping its output covers them.
- **Superseded objects.** Re-uploading an asset file under a new filename
  deletes the object the row previously referenced, together with that object's
  `.status.json` sidecar (same best-effort rules). A re-upload under the same
  filename overwrites in place and deletes nothing.
