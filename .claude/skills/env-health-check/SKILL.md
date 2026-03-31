---
name: env-health-check
description: Validate that all production environments are operable — CD pipeline, Vercel deployments, health APIs, Sentry, and GitHub Actions. Run at session start or after deploys to catch silent failures like broken CD workflows.
---

# Environment Health Check

You are running a systematic health check across all SpawnForge production environments. This skill exists because silent infrastructure failures (like duplicate YAML keys breaking CD for 21+ hours — Lesson #80) are catastrophic when customers are live.

## When to Run

- At the start of every session (triggered by SessionStart hook if stale)
- After merging PRs to main (verify CD triggered)
- After any infrastructure change (workflow files, Vercel config, env vars)
- When the user reports something isn't working in production
- Before and after production deployments

## Checks (run in order)

### 1. CD Pipeline Status

The most critical check — if CD is broken, nothing reaches production.

```bash
# Check last 3 CD runs on main
gh run list --workflow=cd.yml --branch main --limit 3
```

**Evaluate:**
- If the latest run has `0s` duration and `failure` → **CRITICAL: workflow file error** (like Lesson #80)
- If the latest run failed after >0s → investigate with `gh run view <ID> --log-failed`
- If no runs in the last 24h → CD may not be triggering on push

### 2. Vercel Deployment Freshness

```bash
# Check latest production deployment age
vercel ls spawnforge --scope tnolan 2>&1 | head -5
```

**Evaluate:**
- Latest production deployment age vs latest commit on main
- If deploy is >4h older than the latest main commit → **WARNING: deploys not reaching production**
- Compare deploy commit hash against `git log main --oneline -1`

### 3. Production Health API

```bash
curl -s "https://www.spawnforge.ai/api/health" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'Status: {d.get(\"status\")}')
print(f'DB: {d.get(\"database\")}')
print(f'Commit: {d.get(\"commit\")}')
print(f'Timestamp: {d.get(\"timestamp\")}')
"
```

**Evaluate:**
- `status` should be `ok`
- `database` should be `connected`
- `commit` should match the latest deployed commit (cross-reference with Step 2)

### 4. Production Status API

```bash
curl -s "https://www.spawnforge.ai/api/status" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'Overall: {d.get(\"overall\")}')
for s in d.get('services', []):
    icon = '✓' if s['status'] == 'operational' else '✗'
    print(f'  {icon} {s[\"name\"]}: {s[\"status\"]}')
"
```

**Evaluate:**
- `overall` should not be `down` or `major_outage`
- Core services (Database, Authentication, Payments, Engine CDN) must be `operational`
- AI Providers being `down` is acceptable (external dependency)

### 5. Critical Pages HTTP Status

```bash
# Check key pages return correct status codes
for url in \
  "https://www.spawnforge.ai/" \
  "https://www.spawnforge.ai/pricing" \
  "https://www.spawnforge.ai/sign-in" \
  "https://www.spawnforge.ai/api/health"; do
  status=$(curl -sI "$url" 2>&1 | head -1 | awk '{print $2}')
  echo "$status $url"
done
```

**Evaluate:**
- `/` and `/pricing` should be `200`
- `/sign-in` should be `200` (was `500` before PR #8054 fix)
- `/api/health` should be `200`

### 6. Engine CDN Version Parity

The WASM engine is served from Cloudflare R2 via `engine.spawnforge.ai`. A version mismatch between the frontend's baked-in `NEXT_PUBLIC_ENGINE_VERSION` and the actual R2 files means users either get a stale engine or 404s on WASM files — both kill the editor.

```bash
# Check what engine version the production frontend expects
# (baked into the JS bundle at build time — visible in the health API or page source)
HEALTH=$(curl -s "https://www.spawnforge.ai/api/health")
PROD_COMMIT=$(echo "$HEALTH" | python3 -c "import json,sys; print(json.load(sys.stdin).get('commit','unknown'))")

# Check if the CDN has engine files for the production commit
CDN_CHECK=$(curl -sI "https://engine.spawnforge.ai/${PROD_COMMIT}/engine-pkg-webgl2/forge_engine.js" 2>&1 | head -1 | awk '{print $2}')
echo "CDN versioned path (${PROD_COMMIT}): HTTP $CDN_CHECK"

# Also check the /latest/ alias
LATEST_CHECK=$(curl -sI "https://engine.spawnforge.ai/latest/engine-pkg-webgl2/forge_engine.js" 2>&1 | head -1 | awk '{print $2}')
echo "CDN /latest/ path: HTTP $LATEST_CHECK"

# Check root-level (unversioned) engine files
ROOT_CHECK=$(curl -sI "https://engine.spawnforge.ai/engine-pkg-webgl2/forge_engine.js" 2>&1 | head -1 | awk '{print $2}')
echo "CDN root path: HTTP $ROOT_CHECK"
```

**Evaluate:**
- Root-level engine files should return `200` (fallback for local/unversioned builds)
- If `NEXT_PUBLIC_ENGINE_VERSION` is set in the deploy, the versioned path MUST return `200`
- If versioned path returns `404` but root returns `200` → **WARNING: engine version mismatch** — frontend expects a versioned path that doesn't exist on CDN. Users may see WASM loading failures.
- If both versioned AND root return `404` → **CRITICAL: engine CDN is broken** — editor will not load for any user
- `/latest/` alias returning `200` means R2 has at least one upload; returning `404` means no engine has ever been deployed to R2

**Failure scenarios this catches:**
1. CD uploaded new WASM but frontend still references old `ENGINE_VERSION` → version mismatch
2. R2 upload step failed silently but frontend deploy succeeded → 404 on versioned path
3. R2 bucket permissions changed or Cloudflare Worker is down → all paths 404
4. Engine was rebuilt but `upload-wasm-cdn` job was skipped (no engine changes detected) → stale version

### 7. Sentry Error Check

Use the Sentry MCP server:
```
search_issues(organizationSlug='tristan-nolan', projectSlugOrId='spawnforge-ai', naturalLanguageQuery='unresolved errors from last 24 hours')
```

**Evaluate:**
- Zero unresolved issues = clean
- Any unresolved issues → list them with impact assessment

### 7. GitHub Actions Workflow Health

```bash
# Check for workflow file errors (0s failures = YAML parse error)
gh run list --branch main --limit 5 2>&1 | grep -E "failure.*0s"
```

**Evaluate:**
- Any `0s` failures → **CRITICAL: workflow file broken** — check YAML syntax
- Also check for repeated failures on the same workflow

### 8. Staging Environment

```bash
vercel ls spawnforge-staging --scope tnolan 2>&1 | head -3
```

**Evaluate:**
- Staging should have a recent deployment
- If staging deploys but production doesn't → issue is in the production deploy step specifically

### 9. Commit Verification Across All Environments

This is the most important validation — confirms that code pushes actually reached each environment.

```bash
# Get the expected commit (main HEAD)
MAIN_HEAD=$(git rev-parse --short=8 main)
echo "Main HEAD: $MAIN_HEAD"

# Production: check /api/health commit field
PROD_COMMIT=$(curl -s "https://www.spawnforge.ai/api/health" | python3 -c "import json,sys; print(json.load(sys.stdin).get('commit','unknown'))")
echo "Production: $PROD_COMMIT"

# Staging: check Vercel deployment metadata
# The latest staging deploy URL can be inspected for its git SHA
STAGING_URL=$(vercel ls spawnforge-staging --scope tnolan 2>&1 | grep "Ready" | head -1 | awk '{print $3}')
if [ -n "$STAGING_URL" ]; then
  STAGING_COMMIT=$(curl -s "$STAGING_URL/api/health" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('commit','unknown'))" 2>/dev/null || echo "unreachable")
  echo "Staging: $STAGING_COMMIT"
fi

# Docs: check if docs site is reachable
DOCS_STATUS=$(curl -sI "https://docs.spawnforge.ai" 2>&1 | head -1 | awk '{print $2}')
echo "Docs site: HTTP $DOCS_STATUS"

# Design: check if design workbench is reachable
DESIGN_STATUS=$(curl -sI "https://design.spawnforge.ai" 2>&1 | head -1 | awk '{print $2}')
echo "Design site: HTTP $DESIGN_STATUS"
```

**Evaluate:**
- Production commit should match main HEAD (or be at most 1-2 commits behind during active deploy)
- If production commit is >2 commits behind → **WARNING: deploy pipeline stalled**
- If production commit doesn't match ANY recent main commit → **CRITICAL: wrong code deployed**
- Staging commit should match or be ahead of production
- Docs and Design sites should return 200 (they deploy independently)

```bash
# Count how many commits behind production is
PROD_COMMIT_FULL=$(git log --oneline main | grep "^${PROD_COMMIT}" | head -1)
COMMITS_BEHIND=$(git rev-list --count ${PROD_COMMIT}..main 2>/dev/null || echo "unknown")
echo "Production is $COMMITS_BEHIND commits behind main"
```

**Severity thresholds:**
- 0 commits behind → HEALTHY
- 1-2 commits behind → OK (deploy in progress)
- 3-5 commits behind → WARNING (pipeline may be stalled)
- 6+ commits behind → CRITICAL (pipeline is broken)

## Output Format

```markdown
## Environment Health Check — [date/time]

### Summary: [HEALTHY / WARNING / CRITICAL]

| Check | Status | Details |
|-------|--------|---------|
| CD Pipeline | ✓/✗ | [last run status, age] |
| Production Deploy | ✓/✗ | [deploy age, commit match] |
| Health API | ✓/✗ | [status, database, commit] |
| Status API | ✓/✗ | [overall status, service count] |
| Critical Pages | ✓/✗ | [HTTP status codes] |
| Sentry | ✓/✗ | [unresolved count] |
| GitHub Actions | ✓/✗ | [workflow health] |
| Staging | ✓/✗ | [deploy age, commit] |
| Commit Parity | ✓/✗ | [commits behind, mismatch details] |

### Commit Verification
| Environment | Expected | Actual | Match | Behind |
|-------------|----------|--------|-------|--------|
| Production | [main HEAD] | [health API commit] | ✓/✗ | [N commits] |
| Staging | [main HEAD] | [staging health commit] | ✓/✗ | [N commits] |
| Docs | — | HTTP [status] | ✓/✗ | — |
| Design | — | HTTP [status] | ✓/✗ | — |

### Issues Found
- [description of any failures with recommended action]
```

## After Running

Update the timestamp so the SessionStart hook knows:

```bash
date +%s > "$(git rev-parse --show-toplevel)/.claude/.env-health-last-check"
```

## Important Rules

- **Never skip the CD pipeline check** — it's the #1 silent failure mode
- **Compare commits** — deploy freshness means nothing if the wrong commit is live
- **Don't treat AI Provider outages as critical** — they're external and expected
- **Flag 0s workflow failures loudly** — these are always YAML parse errors, never transient
- **Check staging too** — if staging works but production doesn't, the issue is isolated to the production deploy step
