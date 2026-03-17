# Database Backup & Restore Procedures

> **Last updated:** 2026-03-17
> **Owner:** Engineering
> **Review cadence:** Quarterly

This document covers the full lifecycle of SpawnForge's Neon PostgreSQL backup strategy: how backups work, how to restore them, how to verify they are working, and how to export user data for GDPR compliance.

---

## 1. Overview

SpawnForge uses [Neon](https://neon.tech) as its managed PostgreSQL provider. Neon provides continuous WAL-based backups with Point-in-Time Recovery (PITR), meaning the database state can be recovered to any second within the retention window by creating a branch from a historical WAL position.

### Recovery Objectives

| Objective | Target | Notes |
|-----------|--------|-------|
| **RPO** (Recovery Point Objective) | **5 minutes** | Maximum acceptable data loss. Neon WAL flush interval is sub-second in practice; 5 min is a conservative bound for network/flush variability. |
| **RTO** (Recovery Time Objective) | **30 minutes** | Time from incident declaration to application serving traffic from recovered data. Includes branch creation (~2 min), verification (~10 min), and `DATABASE_URL` update + redeploy (~15 min). |

### Retention Window

| Neon Plan | Retention |
|-----------|-----------|
| Free | 1 day |
| Launch | 7 days |
| Scale / Business | 30 days |

SpawnForge production runs on the **Launch plan** (7-day retention). Any data loss event discovered more than 7 days after it occurred cannot be recovered via PITR alone — see [Section 6: Manual Export Strategy](#6-manual-export-strategy).

---

## 2. How Neon PITR Works

Neon stores a continuous Write-Ahead Log (WAL) for every database branch. Each WAL segment is retained for the plan's retention period. To recover to a point in time:

1. Neon creates a new branch by replaying WAL up to the target LSN (Log Sequence Number) corresponding to the requested timestamp.
2. The branch gets its own connection string (endpoint URL) while sharing underlying storage with the parent.
3. No data is copied — branch creation takes seconds regardless of database size.
4. After verification, you promote the recovery branch to production by updating the application's `DATABASE_URL`.

This means **PITR does not require downtime during recovery investigation**. Production continues on the primary branch while you examine the recovery branch independently.

---

## 3. Step-by-Step Restore Procedure

### Pre-Conditions

- Access to [Neon Console](https://console.neon.tech) with project admin rights
- Access to Vercel dashboard (to update environment variables)
- The approximate timestamp of the last known-good state (UTC, ISO-8601 format)

### Phase 1: Create Recovery Branch (target: < 3 minutes)

1. Log in to [https://console.neon.tech](https://console.neon.tech).
2. Select the **spawnforge** project.
3. In the left sidebar, navigate to **Branches**.
4. Click **Create branch**.
5. Configure the branch:
   - **Name:** `recovery-YYYYMMDD-HHMMSS` (e.g., `recovery-20260317-143000`)
   - **Branch from:** `main`
   - **Point in time:** Toggle on, then enter the target UTC timestamp (ISO-8601).
6. Click **Create branch**. Branch creation completes in under 60 seconds.
7. Copy the new branch's connection string from **Branches > [branch name] > Connection string**.

   The connection string format:
   ```
   postgresql://<user>:<password>@<endpoint>.neon.tech/<dbname>?sslmode=require
   ```

### Phase 2: Verify Data Integrity (target: < 10 minutes)

Run the backup verification script against the recovery branch:

```bash
NEON_VERIFY_DB_URL="postgresql://user:pass@endpoint.neon.tech/dbname?sslmode=require" \
  bash scripts/verify-db-backup.sh
```

Expected output:

```
[PASS] Database connection
[PASS] Table: users (N rows)
[PASS] Table: projects (N rows)
[PASS] Table: token_purchases (N rows)
[PASS] Table: token_usage (N rows)
[PASS] Table: cost_log (N rows)
[PASS] Table: credit_transactions (N rows)
[PASS] Table: published_games (N rows)
[PASS] Table: generation_jobs (N rows)
[PASS] Row count sanity checks
[PASS] Referential integrity spot check
[PASS] Schema version check
Health report: HEALTHY
```

If any check fails, review the detailed output, adjust the PITR timestamp, and recreate the branch.

### Phase 3: Promote Recovery Branch (target: < 15 minutes)

**Only proceed if Phase 2 passes all checks.**

1. In Neon Console, navigate to the recovery branch.
2. (Optional) Reset the production `main` branch to the recovery timestamp directly:
   - Go to **Branches > main > Reset to point in time**.
   - Enter the same timestamp used for the recovery branch.
   - Confirm. This modifies `main` in-place and retains the existing connection string — **no `DATABASE_URL` update needed**.

   **OR** promote the recovery branch as the new main:
   - Update `DATABASE_URL` in Vercel: **Settings > Environment Variables > DATABASE_URL**.
   - Update for **Production** and **Preview** environments.
   - Click **Save**.

3. In Vercel, go to **Deployments** and click **Redeploy** on the most recent production deployment.
4. After redeploy, verify `/api/health` returns `{"status":"ok","database":"healthy"}`.
5. Run a smoke test: create a project, save, reload — confirm data persists.

### Phase 4: Post-Restore (target: < 5 minutes)

1. **Document the incident** in the incident log (Notion or GitHub Issues).
2. **Drop the recovery branch** (if it was not promoted): Neon Console > Branches > [recovery branch] > Delete.
3. **Audit the RPO gap**: identify any writes that occurred between the recovery point and the incident. Assess whether those writes need to be replayed manually (e.g., token purchases, subscription changes).
4. **Check Stripe webhooks**: if billing events landed during the gap, replay them from the Stripe dashboard (Developers > Webhooks > [endpoint] > Resend event).

---

## 4. Recovery Scenarios

### 4.1 Accidental Mass Deletion

**Trigger:** A deployment bug, bad migration, or errant admin query deletes rows unexpectedly.

**Recovery:**
1. Identify the timestamp just before the first bad write (check Sentry errors, Vercel function logs, or migration timestamps).
2. Create a recovery branch from that timestamp.
3. Run `scripts/verify-db-backup.sh` to confirm the affected table has the expected row count.
4. If only a subset of rows is affected, extract them from the recovery branch and `INSERT` into production:
   ```sql
   -- Connect to recovery branch, export affected rows
   \COPY (SELECT * FROM projects WHERE user_id = '...' AND created_at > '2026-03-17T00:00:00Z') TO '/tmp/recovered_projects.csv' CSV HEADER;
   -- Connect to production, re-import
   \COPY projects FROM '/tmp/recovered_projects.csv' CSV HEADER;
   ```
5. Drop the recovery branch.

### 4.2 Failed Schema Migration

**Trigger:** A Drizzle migration leaves the schema in an inconsistent state (e.g., partial column rename, missing index, broken constraint).

**Recovery:**
1. Do NOT attempt to reverse the migration manually in production.
2. Create a Neon branch from immediately before the migration ran.
3. Verify the pre-migration state on the branch.
4. Fix the migration script.
5. Apply the corrected migration to the branch first — verify success.
6. Reset the production `main` branch to the pre-migration timestamp (Neon Console > Branches > main > Reset to point in time).
7. Re-apply the corrected migration to production `main`.

### 4.3 Data Corruption

**Trigger:** Application bug writes invalid data (e.g., corrupt `scene_data` JSONB, mangled token balances).

**Recovery:**
1. Identify the time range of corrupt writes via Sentry errors or application logs.
2. Create a recovery branch from before the first corrupt write.
3. If the corruption is limited to specific rows, selectively export and re-import (see 4.1).
4. If corruption is widespread, promote the recovery branch (see Phase 3).

### 4.4 Full Database Loss

**Trigger:** Neon project deleted, catastrophic storage failure (extremely unlikely — Neon replicates across availability zones).

**Recovery:**
1. Contact Neon support immediately: [support.neon.tech](https://support.neon.tech) — they retain WAL beyond what is exposed in the dashboard for 30 days on all paid plans.
2. If WAL is unrecoverable, restore from the most recent manual export (see Section 6).
3. Replay Stripe webhooks for any billing events since the export.
4. Notify affected users per GDPR breach notification requirements (72-hour window).

---

## 5. Backup Verification Checklist (Monthly)

Run this checklist on the first Monday of each month. Estimated time: 15 minutes.

```
[ ] 1. Confirm Neon project exists and main branch is healthy
        URL: https://console.neon.tech
        Check: Last WAL activity timestamp is < 1 minute ago

[ ] 2. Create a test recovery branch from 24 hours ago
        Neon Console > Branches > Create branch > Point in time: (now - 24h)

[ ] 3. Run verification script against the test branch
        NEON_VERIFY_DB_URL="<test-branch-url>" bash scripts/verify-db-backup.sh
        Expected: all checks PASS, report: HEALTHY

[ ] 4. Verify row counts are plausible
        The script outputs row counts for all key tables.
        Confirm users, projects, and token_purchases are non-zero and match
        rough expectations from the admin dashboard.

[ ] 5. Verify referential integrity
        The script checks that all projects.user_id values exist in users.
        Confirm [PASS] on the referential integrity check.

[ ] 6. Drop the test recovery branch
        Neon Console > Branches > [test branch] > Delete

[ ] 7. Record results in the ops log
        Date, branch name, result (PASS/FAIL), any anomalies noted.

[ ] 8. If any check fails, create a PF-xxx ticket tagged [ops, database, urgent]
        Do not close this checklist as complete until the ticket is created.
```

### Quarterly Drill (Full RTO Test)

In addition to the monthly checklist, perform a full RTO drill once per quarter:

```
[ ] 1. Perform all monthly checklist steps above
[ ] 2. Update DATABASE_URL in a Vercel preview environment to the test branch URL
[ ] 3. Trigger a preview deployment
[ ] 4. Run smoke tests against the preview deployment
        - Sign in via Clerk
        - Load an existing project
        - Verify token balance is displayed
        - Save a project modification
[ ] 5. Record actual elapsed time from "branch created" to "preview deployment serving traffic"
        Target: < 30 minutes
[ ] 6. Revert DATABASE_URL in Vercel preview environment
[ ] 7. Drop the test branch
```

---

## 6. Manual Export Strategy

PITR covers the retention window (7 days on Launch plan). For longer-term recovery needs or compliance, maintain manual exports.

### Automated Weekly Export (recommended)

Schedule a weekly `pg_dump` via a Neon-connected cron job or CI pipeline:

```bash
# Run weekly via GitHub Actions or similar
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-acl \
  --no-owner \
  --file="spawnforge-$(date +%Y%m%d).dump"

# Upload to a separate storage location (not the same R2 bucket as engine files)
# e.g., S3 bucket, Backblaze B2, or a second R2 bucket in a different region
```

Retention for manual exports: keep the last 4 weekly snapshots (28 days of coverage beyond PITR window).

### Manual On-Demand Export

Before any high-risk operation (major migration, bulk data operation):

```bash
# Export to SQL format for human-readability during incidents
pg_dump "$DATABASE_URL" \
  --format=plain \
  --no-acl \
  --no-owner \
  --file="spawnforge-pre-$(date +%Y%m%d-%H%M%S).sql"
```

Store in a team-accessible location (not developer laptops).

---

## 7. GDPR Data Export Procedure

Users have the right to receive a machine-readable export of all their personal data under GDPR Article 20.

### Via API (Self-Service)

Users can request their own data export via the authenticated API endpoint:

```
GET /api/user/export-data
Authorization: Bearer <clerk-session-token>
```

The response is a JSON object containing:
- `profile` — display name, email, tier, creation date
- `projects` — all saved projects with scene data
- `tokenUsage` — complete token usage history
- `tokenPurchases` — billing/purchase history
- `creditTransactions` — credit ledger entries
- `publishedGames` — published game metadata
- `feedback` — submitted feedback items
- `generationJobs` — AI generation history

### Via Admin (Manual Request)

If a user contacts support with a data export request and cannot use the self-service API:

1. Identify the user's `clerk_id` from the Clerk dashboard.
2. Look up their row in the `users` table to get their UUID.
3. Run the following query on the production database:

```sql
-- Replace '<user_uuid>' with the actual UUID from the users table

SELECT
  u.id,
  u.clerk_id,
  u.email,
  u.display_name,
  u.tier,
  u.created_at,
  (SELECT json_agg(p.*) FROM projects p WHERE p.user_id = u.id) AS projects,
  (SELECT json_agg(tu.*) FROM token_usage tu WHERE tu.user_id = u.id) AS token_usage,
  (SELECT json_agg(tp.*) FROM token_purchases tp WHERE tp.user_id = u.id) AS token_purchases,
  (SELECT json_agg(ct.*) FROM credit_transactions ct WHERE ct.user_id = u.id) AS credit_transactions,
  (SELECT json_agg(pg.*) FROM published_games pg WHERE pg.user_id = u.id) AS published_games
FROM users u
WHERE u.id = '<user_uuid>';
```

4. Export the result as JSON (`\o output.json` in psql, or via Neon Console query editor > Download).
5. Deliver to the user within 30 days of the request (GDPR requirement).
6. Log the export: date, user ID (not email), request channel, delivery date.

### Data Retention and Deletion

| Data Type | Retention Period | Deletion Trigger |
|-----------|-----------------|-----------------|
| User profile | Until account deletion | `DELETE /api/user/delete` or manual admin action |
| Projects | Until account deletion | Cascade on user delete |
| Token usage logs | 7 years (billing audit) | Manual purge after retention period |
| Webhook idempotency records | 48 hours (TTL) | Automatic expiry |
| Generation job records | Anonymized on account deletion | Foreign key set to NULL or deleted |
| Published games | Unpublished and removed on account deletion | Cascade |

For the Right to Erasure (`DELETE /api/user/delete`), confirm the cascading deletes cover all tables with `user_id` foreign keys:
- `api_keys`, `provider_keys`, `token_usage`, `token_purchases`, `projects`, `cost_log`, `credit_transactions`, `published_games`, `generation_jobs`, `feedback`, `moderation_appeals`, `seller_profiles`, `game_ratings`, `game_comments`, `game_likes`, `user_follows`, `asset_purchases`, `asset_reviews`

---

## 8. Related Documents

- [Backup & Recovery Strategy](./operations/backup-recovery.md) — high-level strategy and asset backup
- [Production Support Runbook](./production-support.md) — incident response, service runbooks, escalation
- [Monitoring Setup](./operations/monitoring-setup.md) — health checks, alerting configuration
- [Incident Runbook](./operations/incident-runbook.md) — P0/P1 response process

---

## 9. Escalation Contacts

| Situation | Contact |
|-----------|---------|
| Neon platform issue (not user error) | [Neon Support](https://support.neon.tech) — include project ID and branch name |
| Data loss suspected | Engineering on-call (PagerDuty) |
| GDPR data request | Engineering + Legal |
| Billing data discrepancy | Engineering + Finance |
