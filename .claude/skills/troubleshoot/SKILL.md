---
name: troubleshoot
description: Diagnose failures across the SpawnForge stack — WASM build, CI pipeline, dev server, production, E2E tests, engine panics, and external services. Use when something is broken and you need structured triage.
user-invocable: true
allowed-tools: Bash, Read, Glob, Grep, Agent, WebFetch
argument-hint: "[area: wasm|ci|dev|prod|e2e|engine|services|auto]"
---

# Troubleshooting Guide

Systematically diagnose SpawnForge failures. Default to `auto` which runs through all areas.

## Triage Order

Always investigate in this order — later steps often depend on earlier ones being healthy.

### 1. WASM Build Failures

```bash
# Check if engine-pkg directories exist and are recent
ls -la web/public/engine-pkg-*/forge_engine_bg.wasm 2>/dev/null
# Check wasm-bindgen version match (must be 0.2.108)
grep 'wasm-bindgen' engine/Cargo.lock | head -5
# Try a build and capture errors
powershell -ExecutionPolicy Bypass -File build_wasm.ps1 2>&1 | tail -50
```

**Common causes:**
- `wasm-bindgen` version mismatch (pinned to 0.2.108 — check `Cargo.lock` vs installed CLI)
- Missing `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`
- Bevy feature errors: ensure `tonemapping_luts` is enabled (without it, materials render pink)
- `csgrs` build: needs Windows SDK LIB paths for `doc-image-embed` proc-macro on native. `build_wasm.ps1` handles this
- `wasm-opt` not found: install via `cargo install wasm-opt` or `npm i -g wasm-opt`

### 2. CI Pipeline Failures

```bash
# Recent workflow runs
gh run list --limit 5
# Failed run details
gh run view <ID> --log-failed
# Check if gate job is stuck (path-filter + required-checks issue)
gh pr checks <PR_NUMBER>
```

**Common causes:**
- Gate job shows "Expected" forever: path filters skip jobs, but required checks need them to run. Fix: add `gate` job that always runs
- Coverage hangs: vitest + jsdom open handles (vitest#3077). Use `--pool=threads --coverage` with timeout wrapper
- Artifact version mismatches: upload-artifact v4 vs download-artifact v4 (must match)
- `npm ci` lock mismatch: delete `node_modules`, re-run `npm ci`

### 3. Dev Server Issues

```bash
# Check if Portless is running
curl -s http://spawnforge.localhost:1355 > /dev/null 2>&1 && echo "Portless OK" || echo "Portless not running"
# Fallback without Portless
cd web && PORTLESS=0 npm run dev
# Check for port conflicts
lsof -i :3000 -i :1355 2>/dev/null
```

**Common causes:**
- Portless not installed/running: fall back to `localhost:3000`
- Clerk keys missing: use `/dev` route to bypass auth
- WASM not built: engine-pkg directories missing or stale
- Turbopack issues: dev uses `--webpack` flag for compatibility

### 4. Production / Vercel Issues

```bash
# Recent deployments
vercel ls --limit 5
# Runtime logs
vercel logs <deployment-url> --since 1h
# Environment variables
vercel env ls
```

**Common causes:**
- Missing env vars: run `vercel env ls` and compare with `.env.example`
- Build failures: check Vercel build logs, often CSP or Clerk key format issues
- Stale WASM: content hash mismatch between deploy and CDN (`engine.spawnforge.ai`)

### 5. E2E Test Failures

```bash
# Run single test with debug
cd web && npx playwright test <test-name> --debug
# Check test report
cd web && npx playwright show-report
# Common: hydration dialog selector changed
grep -r "dialog\|getByRole" web/e2e/tests/ | head -10
```

**Common causes:**
- Hydration dialogs: Clerk/Next.js hydration creates dialogs that intercept clicks. Use `page.getByRole('dialog')` checks
- Stale WASM: E2E tests need a fresh WASM build
- Cold start: first test after build is slow, increase timeout
- Missing test tags: `@smoke`, `@critical` tags for CI filtering

### 6. Engine Panics (Rust/WASM)

```bash
# Check browser console for panic messages
# Common: B0001 (query conflicts) or B0002 (resource conflicts)
grep -r "B0001\|B0002\|ParamSet" engine/src/ | head -10
# Check for system parameter conflicts
grep -rn "Res<.*>\|ResMut<.*>" engine/src/bridge/ | grep -v "^Binary"
```

**Common causes:**
- B0001: Two queries with overlapping `&T` / `&mut T`. Fix: use `ParamSet`
- B0002: Both `Res<T>` and `ResMut<T>` for same resource. Fix: use only `ResMut<T>`
- System param limit (16): merge related queries
- Missing feature gate: `#[cfg(feature = "webgpu")]` for Hanabi systems

### 7. External Service Health

```bash
# Sentry
curl -s https://sentry.io/api/0/ -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" | head -1

# Neon DB
cd web && npx drizzle-kit studio 2>&1 | head -5

# Stripe webhooks
stripe events list --limit 3 2>/dev/null || echo "Stripe CLI not configured"

# Check health endpoint
curl -s http://spawnforge.localhost:1355/api/health 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "Health endpoint unreachable"
```

**Service reference:**
| Service | Dashboard | Key env var |
|---------|-----------|-------------|
| Sentry | tristan-nolan / spawnforge-ai | `SENTRY_AUTH_TOKEN` |
| Neon | Vercel Marketplace | `DATABASE_URL` |
| Upstash | Vercel Marketplace | `UPSTASH_REDIS_REST_URL` |
| Clerk | clerk.com | `CLERK_SECRET_KEY` |
| Stripe | dashboard.stripe.com | `STRIPE_SECRET_KEY` |
| PostHog | posthog.com | `NEXT_PUBLIC_POSTHOG_KEY` |
| R2 CDN | engine.spawnforge.ai | `CLOUDFLARE_R2_*` |

## Auto Mode

When `$ARGUMENTS` is empty or `auto`, run through all areas in order, stopping at the first failure found. Report findings with specific file paths and line numbers.
