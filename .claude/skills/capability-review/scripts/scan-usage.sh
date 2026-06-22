#!/usr/bin/env bash
#
# Adoption fingerprint for `capability-review`.
#
# For each tracked provider, prints the installed SDK version (where it is an npm
# dep) and, per capability, whether our PRODUCT code touches it (`using`) or not
# (`GAP`). A GAP on an already-installed SDK is a candidate adoption opportunity
# — confirm in-context before reporting (a feature may be wired under another name).
#
# This is a LEAD generator, not a verdict. It deliberately searches only product /
# config paths (web, mcp-server, packages, apps, infra, root manifests) and NEVER
# the skill's own references/ — otherwise the marker list in capability-map.md
# would make every capability self-report as "using".
#
# Output only; never fails the shell. macOS/BSD-safe (uses `git grep`, no GNU-only
# flags). Run: bash .claude/skills/capability-review/scripts/scan-usage.sh

set -uo pipefail

repo_root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null)"
if [ -z "${repo_root:-}" ]; then
  echo "Not inside a git repository — cannot fingerprint." >&2
  exit 1
fi
cd "$repo_root" || exit 1

# Product/config search roots that actually exist (tracked or untracked, never ignored).
SEARCH_PATHS=()
for p in web mcp-server packages apps infra package.json vercel.json vercel.ts; do
  [ -e "$p" ] && SEARCH_PATHS+=("$p")
done
if [ "${#SEARCH_PATHS[@]}" -eq 0 ]; then
  echo "No product paths found to search." >&2
  exit 1
fi

# ver <pkg> — print the version range from web/ or root package.json, or "-".
ver() {
  node -e '
    const fs = require("fs");
    const want = process.argv[1];
    const find = () => {
      for (const f of ["web/package.json", "package.json", "mcp-server/package.json"]) {
        try {
          const p = JSON.parse(fs.readFileSync(f, "utf8"));
          const d = { ...p.dependencies, ...p.devDependencies };
          if (d[want]) return d[want] + "  (" + f + ")";
        } catch { /* ignore */ }
      }
      return "-";
    };
    process.stdout.write(find());
  ' "$1" 2>/dev/null
}

# check <label> <ERE> — mark using/GAP based on a product-code match.
check() {
  local label="$1" pat="$2" hit
  hit="$(git grep -lEI --untracked -e "$pat" -- "${SEARCH_PATHS[@]}" 2>/dev/null | head -1)"
  if [ -n "$hit" ]; then
    printf '  using  %-26s  %s\n' "$label" "$hit"
  else
    printf '  GAP    %-26s\n' "$label"
  fi
}

section() { printf '\n=== %s ===\n' "$1"; }
installed() { printf '  installed: %s\n' "$(ver "$1")"; }

printf 'Capability adoption fingerprint — %s\n' "$(date +%F)"
printf 'using = product code touches it · GAP = no match (candidate opportunity)\n'

section "PostHog  (posthog-js)"
installed "posthog-js"
check "event capture"       'posthog\.capture'
check "feature flags"       'posthog\.(feature_flags|isFeatureEnabled)|useFeatureFlag'
check "session replay"      'startSessionRecording|session_recording'
check "LLM observability"   '[$]ai_generation'
check "experiments"         'getFeatureFlagPayload|experiment'
check "group analytics"     'posthog\.group'

section "Sentry  (@sentry/nextjs)"
installed "@sentry/nextjs"
check "error capture"       'Sentry\.(captureException|captureMessage)'
check "tracing"             'tracesSampleRate'
check "profiling"           'profilesSampleRate|nodeProfilingIntegration'
check "cron monitors"       'Sentry\.cron|withMonitor'
check "uptime monitoring"   'uptime'
check "session replay"      'replayIntegration'
check "AI/LLM spans"        'vercelAIIntegration|Sentry\.ai'
check "user feedback"       'captureFeedback|Feedback\b'

section "Vercel Analytics / Observability"
check "web analytics"       '@vercel/analytics'
check "speed insights"      '@vercel/speed-insights'
check "OpenTelemetry"       '@vercel/otel|registerOTel'
check "waitUntil/after"     'waitUntil|[^a-zA-Z]after\('
check "BotID"               'BotId|@vercel/bot'
check "vercel.ts config"    '@vercel/config'

section "Cloudflare"
check "R2"                  'R2Bucket|spawnforge-engine|wrangler'
check "Workers AI"          'workers-ai|@cf/'
check "Vectorize"           'Vectorize'
check "D1"                  'D1Database'
check "Hyperdrive"          'Hyperdrive'

section "Upstash"
check "Redis"               '@upstash/redis'
check "Ratelimit"           '@upstash/ratelimit'
check "QStash (queues)"     '@upstash/qstash'
check "Workflow"            '@upstash/workflow'
check "Vector"              '@upstash/vector'

section "Neon  (@neondatabase/serverless)"
installed "@neondatabase/serverless"
check "serverless driver"   '@neondatabase/serverless|getNeonSql'
check "DB branching"        'neon.*branch|createBranch'
check "Data API"            'data-api|neon.*rest'

section "AI SDK  (ai)"
installed "ai"
check "streaming chat"      'toUIMessageStreamResponse|streamText'
check "structured output"   'generateObject|streamObject'
check "tools"               'tool\(|toolCall'
check "prompt caching"      'cache_control|cacheControl'
check "AI Gateway"          'ai-gateway|gateway/'
check "embeddings"          'embed\(|embedMany'

section "Stripe  (stripe)"
installed "stripe"
check "checkout"            'stripe\.checkout|checkout\.sessions'
check "subscriptions"       'stripe\.subscriptions|subscription'
check "billing meters"      'billing\.meters|billing/meters'
check "automatic tax"       'automatic_tax|stripe\.tax'
check "radar (fraud)"       'radar'
check "entitlements"        'entitlements'

section "Clerk  (@clerk/nextjs)"
installed "@clerk/nextjs"
check "auth middleware"     'clerkMiddleware|@clerk/nextjs'
check "organizations/B2B"   'Organization(Profile|Switcher|List)|useOrganization'
check "appearance API"      'appearance|baseTheme'

printf '\nDone. Treat each GAP as a lead — confirm by date with a search, then price it.\n'
