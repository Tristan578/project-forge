# SpawnForge Infrastructure Runbook

Quick runbook for common operational tasks. All commands assume you are in the project root unless otherwise noted.

---

## Vercel

### Check deployment status
```bash
vercel ls --scope tnolan | head -10
```

### View runtime logs (last hour)
```bash
vercel logs <deployment-url> --since 1h --scope tnolan
# Or specify the project:
vercel logs --scope tnolan --follow
```

### Rollback a deployment
1. Find the previous stable deployment:
   ```bash
   vercel ls --scope tnolan | grep "ready" | head -5
   ```
2. Promote a previous deployment to production:
   ```bash
   vercel promote <deployment-url> --scope tnolan
   ```
3. Verify the rollback is live:
   ```bash
   curl -I https://spawnforge.ai
   ```

### Pull environment variables to local
```bash
cd web && vercel env pull .env.local --scope tnolan
```

### Check if a preview deployment is accessible
```bash
vercel curl <preview-deployment-url>/api/health --scope tnolan
```

---

## Sentry

### Check recent errors (org: tristan-nolan, project: spawnforge-ai)
Use the Sentry MCP tools:
```
search_issues(org="tristan-nolan", project="spawnforge-ai", query="is:unresolved")
```

Or via browser: https://sentry.io/organizations/tristan-nolan/issues/?project=spawnforge-ai

### Inspect a specific error
```
get_issue_details(issue_id="<issue_id>")
```

### Check for errors from a specific deploy
```
search_events(project="spawnforge-ai", query="release:<git-sha>")
```

---

## Cloudflare R2 CDN

### Verify CDN is serving WASM binaries
```bash
curl -I https://engine.spawnforge.ai/engine-pkg-webgpu/forge_engine_bg.wasm
# Expect: HTTP 200 with content-type application/wasm
# Expect: Access-Control-Allow-Origin: *  (set by Worker)
```

### Upload a new WASM build to R2
```bash
# Use the /deploy-engine skill which handles this automatically
# Or manually:
wrangler r2 object put spawnforge-engine/engine-pkg-webgpu/forge_engine_bg.wasm \
  --file web/public/engine-pkg-webgpu/forge_engine_bg.wasm \
  --remote \
  --account-id 0b949ff499d179e24dde841f71d6134f
```

### Check if Worker is deployed and healthy
```bash
wrangler deployments list --name engine-cdn
```

---

## Neon (Postgres Database)

### Check database connectivity
```bash
cd web && npm run db:studio
# Opens browser-based DB viewer — if it loads, DB is reachable
```

### Run a direct query (requires NEON_API_KEY)
Use the Neon MCP tool:
```
query("SELECT COUNT(*) FROM users")
```

### Apply pending migrations
```bash
cd web && npm run db:migrate
```

### Generate a migration after schema change
```bash
cd web && npm run db:generate
# Then review the generated file in web/src/lib/db/migrations/
```

---

## Upstash Redis (Rate Limiting)

### Check rate limit state for an IP (via Upstash console)
1. Go to https://console.upstash.com
2. Select the Redis database
3. Use the Data Browser to inspect `ratelimit:*` keys

### Clear rate limits for testing
```bash
# Use Upstash REST API with credentials from .env.local
curl -X POST "${UPSTASH_REDIS_REST_URL}/del/ratelimit:<ip-address>" \
  -H "Authorization: Bearer ${UPSTASH_REDIS_REST_TOKEN}"
```

---

## Stripe Webhooks (Local Testing)

### Forward Stripe events to local dev server
```bash
stripe listen --forward-to http://spawnforge.localhost:1355/api/webhooks/stripe
```

### Trigger a test event
```bash
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
```

### View recent webhook attempts
```bash
stripe events list --limit 10
```

---

## GitHub Actions CI

### Check status of a workflow run
```bash
gh run list --limit 5
gh run view <run-id>
gh run view <run-id> --log-failed
```

### Re-run a failed workflow
```bash
gh run rerun <run-id> --failed-only
```

### Check if a required check is stuck
```bash
gh pr checks <pr-number>
# If "Expected" appears, the gate job hasn't received signals from skipped jobs
```
