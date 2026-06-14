#!/usr/bin/env bash
# Verify the OpenAPI spec (docs/api/openapi.json) is well-formed and stays in
# sync with the actual API surface under web/src/app/api/**/route.ts.
#
# WHY THIS GATE EXISTS — two failure modes, both shipped live:
#
#   1. MALFORMED SPEC. docs/api/openapi.json is served verbatim by
#      web/src/app/api/openapi/route.ts (JSON.parse(raw)) and rendered by
#      Swagger UI at /api-docs. A single trailing comma makes that parse throw —
#      not an ENOENT — so the route falls through to its 500 branch and the
#      entire public API reference 500s in production. This was LIVE on main
#      (trailing comma before the final `}` of `paths`). A JSON-validity check
#      here turns a silent prod 500 into a red PR.
#
#   2. DOC DRIFT. The spec documents N paths; the app has M route files. When a
#      new route ships undocumented, the published contract silently rots — and
#      nothing catches it because the spec is hand-maintained with no generator.
#      This gate enumerates every route.ts, normalizes its path the same way
#      OpenAPI keys it ([param] -> {param}, [...rest] -> {rest}, (groups)
#      stripped, prefixed /api), and asserts each route is EITHER documented in
#      the spec OR listed in the internal-routes allowlist. A new undocumented,
#      un-allowlisted route fails the PR. This is a ratchet: it does not force
#      the 45 pre-existing internal routes to be documented, it stops the
#      drift from growing.
#
# The allowlist (docs/api/openapi-internal-routes.json) is kept honest by two
# reverse checks: an entry whose route file no longer exists is STALE, and an
# entry that is ALSO documented is REDUNDANT — both fail, so the list can't
# accumulate dead weight or shadow a now-public route.
#
# This is a CHECK, not a fixer: it never edits the spec. Fixes:
#   - malformed spec  -> repair docs/api/openapi.json (it must be valid JSON)
#   - undocumented    -> add the path to docs/api/openapi.json, OR add it to
#                        docs/api/openapi-internal-routes.json with a category
#   - stale/redundant -> remove the offending line from the allowlist
#
# Gated in ci.yml on the ci-gate `needs-api` output (any web/src/app/api change,
# the spec, the allowlist, this script, or its test) and wired into the required
# CI Success aggregate, so it is required when it runs yet skips cleanly on PRs
# that touch no API surface. Decision logic is unit-tested by
# scripts/__tests__/check-openapi-route-sync.test.sh (run by the
# lockfile-sync-tests / "CI Self-Defense Tests" job).
#
# TEST SEAM: OPENAPI_SPEC / OPENAPI_ALLOWLIST / OPENAPI_API_DIR override the
# three inputs so the self-defense test can point the gate at a throwaway tree.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || { echo "::error::cannot cd to repo root"; exit 1; }

SPEC="${OPENAPI_SPEC:-docs/api/openapi.json}"
ALLOWLIST="${OPENAPI_ALLOWLIST:-docs/api/openapi-internal-routes.json}"
API_DIR="${OPENAPI_API_DIR:-web/src/app/api}"

fail=0
err() { echo "::error::$*"; fail=1; }

# --- 1. Spec must exist and be valid JSON (the live prod-500 class) -----------
if [ ! -f "$SPEC" ]; then
  err "OpenAPI spec not found at $SPEC"
  exit 1
fi
if ! jq empty "$SPEC" >/dev/null 2>&1; then
  err "OpenAPI spec $SPEC is not valid JSON — /api/openapi would 500 in production. Fix the JSON (commonly a trailing comma):"
  jq empty "$SPEC" 2>&1 | head -5 | sed 's/^/    /'
  exit 1
fi

# --- 2. Allowlist must exist, be valid JSON, name only known categories -------
if [ ! -f "$ALLOWLIST" ]; then
  err "internal-routes allowlist not found at $ALLOWLIST"
  exit 1
fi
if ! jq empty "$ALLOWLIST" >/dev/null 2>&1; then
  err "allowlist $ALLOWLIST is not valid JSON"
  exit 1
fi

# Every route's category must be defined in .categories.
bad_categories="$(jq -r '
  (.categories // {}) as $cats
  | (.routes // {}) | to_entries[]
  | select(($cats[.value]) == null)
  | "\(.key) -> \(.value)"
' "$ALLOWLIST")"
if [ -n "$bad_categories" ]; then
  err "allowlist entries reference an undefined category (add it under .categories):"
  while IFS= read -r line; do echo "    $line"; done <<< "$bad_categories"
fi

# --- 3. Enumerate + normalize the actual route surface ------------------------
if [ ! -d "$API_DIR" ]; then
  err "API route directory not found at $API_DIR"
  exit 1
fi

routes_file="$(mktemp)"
documented_file="$(mktemp)"
allowlisted_file="$(mktemp)"
known_file="$(mktemp)"
trap 'rm -f "$routes_file" "$documented_file" "$allowlisted_file" "$known_file"' EXIT

# route.ts path -> OpenAPI-style path. Mirrors how Next.js App Router segments
# map to URL paths and how OpenAPI keys them:
#   strip the leading API_DIR and trailing /route.ts
#   /(group)            -> ''        (route groups are not URL segments)
#   [[...rest]]         -> {rest}    (optional catch-all — MUST run before the
#                                     plain catch-all rule below, else the inner
#                                     [...rest] matches first and leaves {{rest}})
#   [...rest]           -> {rest}    (catch-all)
#   [param]             -> {param}   (dynamic)
#   prefix with /api
find "$API_DIR" -name route.ts \
  | sed "s#^${API_DIR}##; s#/route\.ts\$##" \
  | sed -E 's#/\([^/]*\)##g; s/\[\[\.\.\.([^]]+)\]\]/{\1}/g; s/\[\.\.\.([^]]+)\]/{\1}/g; s/\[([^]]+)\]/{\1}/g' \
  | sed 's#^#/api#' \
  | sort -u > "$routes_file"

# Fail closed on an empty enumeration: an API_DIR that exists but contains no
# route.ts (e.g. a mis-pointed path like /tmp) would make every set-difference
# below empty and the gate pass vacuously. Refuse it.
if [ ! -s "$routes_file" ]; then
  err "no route.ts found under $API_DIR — refusing to pass vacuously (is the path correct?)"
  exit 1
fi

jq -r '.paths // {} | keys[]' "$SPEC" | sort -u > "$documented_file"
jq -r '.routes // {} | keys[]' "$ALLOWLIST" | sort -u > "$allowlisted_file"

# --- 4. Routes that are neither documented nor allowlisted = VIOLATIONS --------
# (routes) minus (documented ∪ allowlisted)
cat "$documented_file" "$allowlisted_file" | sort -u > "$known_file"
violations="$(comm -23 "$routes_file" "$known_file")"
if [ -n "$violations" ]; then
  err "undocumented API route(s) — add to docs/api/openapi.json, or to the allowlist ($ALLOWLIST) with a category:"
  while IFS= read -r line; do echo "    $line"; done <<< "$violations"
fi

# --- 5. Allowlist hygiene -----------------------------------------------------
# 5a. STALE: allowlisted path with no matching route file.
stale="$(comm -13 "$routes_file" "$allowlisted_file")"
if [ -n "$stale" ]; then
  err "stale allowlist entr(y/ies) — no route.ts maps to these, remove them from $ALLOWLIST:"
  while IFS= read -r line; do echo "    $line"; done <<< "$stale"
fi

# 5b. REDUNDANT: allowlisted path that is ALSO documented — it became public, so
#     drop it from the allowlist to keep the list to genuinely-internal routes.
redundant="$(comm -12 "$documented_file" "$allowlisted_file")"
if [ -n "$redundant" ]; then
  err "allowlist entr(y/ies) also documented in the spec — now public, remove from $ALLOWLIST:"
  while IFS= read -r line; do echo "    $line"; done <<< "$redundant"
fi

# --- 6. Verdict ---------------------------------------------------------------
if [ "$fail" -ne 0 ]; then
  exit 1
fi
echo "OpenAPI spec valid; all $(wc -l < "$routes_file" | tr -d ' ') routes documented or allowlisted."
exit 0
