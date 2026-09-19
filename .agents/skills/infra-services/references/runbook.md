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
1. Find the deployment that is serving production (`vercel ls` prints `● Ready`
   for every deployment and cannot tell you which one is live):
   ```bash
   vercel rolling-release fetch --scope tnolan --cwd web   # currentDeployment = the live base
   curl -s https://www.spawnforge.ai/api/health | jq .commit
   ```
2. Roll back with Instant Rollback (never `vercel promote`: under Rolling
   Releases it starts a staged rollout of the old build, or no-ops mid-rollout):
   ```bash
   vercel rollback <deployment-url> --yes --scope tnolan
   ```
3. Verify the rollback is live — by commit, not by status code (`curl -I` on the
   apex answers 307 to www and says nothing about which build answered):
   ```bash
   curl -s https://www.spawnforge.ai/api/health | jq .commit   # must equal the restored deployment's commit
   ```
4. Undo the rollback once a fix is ready. Instant Rollback turns auto-assignment
   of production domains OFF: pushes to `main` do not go live by themselves until
   a rolling release completes. CD's `ensure-canary` step starts its rollout
   explicitly; if that run reports it could not become the canary:
   ```bash
   vercel promote <fixed-deployment-url> --scope tnolan   # vercel.com/docs/instant-rollback#undo-a-rollback
   ```

### Pull environment variables to local
```bash
cd web && vercel env pull .env.local --scope tnolan
```

### Check if a preview deployment is accessible
`vercel curl` cannot authenticate against Vercel Authentication from CI (it
warned-and-passed on every production run until #9624). Probe the CANARY through
the public domain instead, or send the project's automation bypass secret as a
header:
```bash
curl -s 'https://www.spawnforge.ai/api/health?vcrrForceCanary=true' | jq .commit
curl -s -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS" <deployment-url>/api/health
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
