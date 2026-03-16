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
| PITR branch creation | Quarterly | Create a Neon branch from 24h ago, verify data integrity, drop branch |
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
