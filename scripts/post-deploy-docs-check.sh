#!/usr/bin/env bash
# post-deploy-docs-check.sh
#
# Post-deploy smoke check for the docs site's MCP command reference. Probes the
# two routes that render `data/commands.json`, fails on anything short of a
# populated page, and fails unless every accepted page carries the commit
# stamp of the deploy this run made.
#
# Usage:
#   DOCS_CHECK_EXPECT_COMMIT=<sha> bash scripts/post-deploy-docs-check.sh <base-url>
#
# Arguments:
#   base-url   Origin to probe, no trailing slash (https://docs.spawnforge.ai).
#              cd.yml passes the production alias: the Vercel deployment URL is
#              behind Deployment Protection and cannot be observed from here,
#              and the alias is what readers load.
#
# Environment variables:
#   DOCS_CHECK_EXPECT_COMMIT REQUIRED. The commit this run deployed (cd.yml
#                            passes github.sha; 8 to 40 hex chars, either
#                            case). Every accepted page must carry
#                            <meta name="spawnforge-docs-commit" content="<sha>">
#                            whose first 8 chars match, compared case-
#                            insensitively. The layout renders it from
#                            VERCEL_GIT_COMMIT_SHA (apps/docs/lib/commit.ts).
#                            There is no optional mode: without the commit the
#                            gate can only prove that SOME build is healthy.
#
#                            RUNTIME PREREQUISITE: VERCEL_GIT_COMMIT_SHA only
#                            reaches the docs build when the spawnforge-docs
#                            Vercel project has "Automatically expose System
#                            Environment Variables" enabled (Settings ->
#                            Advanced; docs/production-support.md section 13
#                            documents the same toggle for the spawnforge
#                            project, and apps/docs/README.md lists it under
#                            Environment Variables). With it off, every page
#                            stamps 'unknown' and this gate fails closed on
#                            every attempt. Nothing in this repo can set it —
#                            it is a per-project dashboard setting.
#   DOCS_CHECK_CATEGORY      Category page to probe (default: scene)
#   DOCS_CHECK_COMMAND       Command name that must be rendered on that page
#                            (default: spawn_entity). Keep in step with
#                            apps/docs/lib/__tests__/commandsManifestArtifact.test.ts,
#                            which pins the same pair against the manifest;
#                            scripts/__tests__/post-deploy-docs-check.test.sh
#                            fails CI when the two disagree.
#   DOCS_CHECK_RETRIES       Attempts per route before failing (default: 3)
#   DOCS_CHECK_INTERVAL_S    Seconds between attempts (default: 10)
#   DOCS_CHECK_STABILIZE_S   Seconds to wait before the first probe (default: 30)
#   DOCS_CHECK_TIMEOUT_S     curl max-time per request (default: 15)
#
# Exit codes:
#   0  Both routes returned 200 with the expected content, stamped with the
#      expected commit
#   1  Any route was non-200, unobservable (protection on the alias), 200 with
#      the content missing, or 200 from a different build — the deploy is not
#      verified.
#
# WHY CONTENT, NOT JUST STATUS
#
# docs.spawnforge.ai/mcp 500'd in production for weeks (#9718) with no probe
# anywhere; the fix for the previous incarnation of the same bug (#9065) also
# never worked in production, and its test could not see that. Both times the
# artifact was broken while every gate was green. So this gate reads the
# artifact: `/mcp` renders a category tile ONLY when there are public
# commands (it renders "No public commands available yet" with a 200
# otherwise), and `/mcp/<category>` renders each command as a heading. A 200
# that carries neither is the "0 commands" page and is a failure here — the
# adjacent-property mistake of lessons-learned #1.
#
# WHY THE COMMIT, NOT JUST CONTENT
#
# The alias can keep serving the PREVIOUS healthy build — alias assignment
# lag, or a --prod deploy whose domain set did not include docs.spawnforge.ai
# — and a content-only probe goes green against the old artifact. A healthy
# body proves that SOMETHING is healthy; only the commit stamp proves it is
# the build this run published (post-deploy-health-check.sh learned the same
# lesson with /api/health's commit field). A mismatch on one attempt is
# retried, because alias lag resolves; a mismatch on every attempt fails.

set -euo pipefail

usage() {
  echo "::error::Usage: DOCS_CHECK_EXPECT_COMMIT=<sha> $0 <base-url> — $1" >&2
  exit 1
}

# ---------- arguments & defaults ------------------------------------------

BASE_URL="${1:-}"
if [[ -z "$BASE_URL" ]]; then
  usage "base-url is required"
fi
BASE_URL="${BASE_URL%/}"

EXPECT_COMMIT="${DOCS_CHECK_EXPECT_COMMIT:-}"
if [[ -z "$EXPECT_COMMIT" ]]; then
  usage "DOCS_CHECK_EXPECT_COMMIT is unset; without it the probe cannot be tied to the deploy under test"
fi
if [[ ! "$EXPECT_COMMIT" =~ ^[0-9a-fA-F]{8,40}$ ]]; then
  usage "DOCS_CHECK_EXPECT_COMMIT must be 8 to 40 hex chars, got '${EXPECT_COMMIT}'"
fi

# How many leading hex chars of the expected and reported commits are compared.
# The expectation may be a full SHA and the stamp an abbreviation (or the other
# way round), so only a common prefix can be compared.
#
# apps/docs/lib/commit.ts must never render a stamp SHORTER than this: a
# 7-char stamp of the very commit under test could not equal an 8-char
# expectation, and the right build would be reported as a different one.
# scripts/__tests__/post-deploy-docs-check.test.sh extracts this line and that
# module's GIT_SHA minimum and fails when the minimum drops below this width;
# keep the `COMMIT_COMPARE_WIDTH=<n>` line in exactly this shape.
COMMIT_COMPARE_WIDTH=8

# Both sides are case-folded before comparing. The validation above accepts
# [0-9a-fA-F], so an upper-case expected SHA is legal input; comparing it
# case-sensitively against the lower-case stamp git and Vercel produce would
# fail every attempt with the "DIFFERENT build" diagnosis — the same commit
# reported as a different one, sending the operator after alias lag that is
# not there.
EXPECT_COMMIT_SHORT="${EXPECT_COMMIT,,}"
EXPECT_COMMIT_SHORT="${EXPECT_COMMIT_SHORT:0:$COMMIT_COMPARE_WIDTH}"

CATEGORY="${DOCS_CHECK_CATEGORY:-scene}"
COMMAND="${DOCS_CHECK_COMMAND:-spawn_entity}"
RETRIES="${DOCS_CHECK_RETRIES:-3}"
INTERVAL="${DOCS_CHECK_INTERVAL_S:-10}"
STABILIZE="${DOCS_CHECK_STABILIZE_S:-30}"
TIMEOUT="${DOCS_CHECK_TIMEOUT_S:-15}"

# The <meta name> the layout stamps the commit under. The bash suite extracts
# this line and compares it with DOCS_COMMIT_META_NAME in apps/docs/lib/commit.ts.
COMMIT_META_NAME='spawnforge-docs-commit'

# TEST SEAM: the suite points this at a scratch file. Never set in CI (the
# suite asserts no workflow wires it).
RESPONSE_FILE="${DOCS_RESPONSE_FILE:-/tmp/docs_mcp_response.html}"

INDEX_URL="${BASE_URL}/mcp"
CATEGORY_URL="${BASE_URL}/mcp/${CATEGORY}"

# What a populated page contains and an empty one does not. The index tile is
# `<a href="/mcp/<category>">`; the category page renders `<h2 ...>name</h2>`.
# Both are matched as fixed strings against the raw HTML, with the angle
# brackets included so a prose mention of the command name elsewhere on the
# page does not satisfy the check.
INDEX_MARKER="href=\"/mcp/${CATEGORY}\""
CATEGORY_MARKER=">${COMMAND}<"

CURL_ARGS=(--silent --show-error --max-time "$TIMEOUT")

# ---------- commit stamp ----------------------------------------------------
#
# commit_of_body <file>: prints the hex content of the commit <meta>, or
# nothing when the tag is absent or its content is not hex (the layout stamps
# 'unknown' for a build with no SHA — that must read as "no commit", never as
# a value to compare).
commit_of_body() {
  local tag
  tag="$(grep -oE "<meta[^>]*name=\"${COMMIT_META_NAME}\"[^>]*>" "$1" 2>/dev/null | head -1 || true)"
  [ -n "$tag" ] || return 0
  printf '%s' "$tag" | grep -oE 'content="[0-9a-fA-F]+"' | head -1 | sed -E 's/^content="//; s/"$//' || true
}

# ---------- one route, with retries ---------------------------------------
#
# probe <url> <marker> <what-the-marker-proves>
# Returns 0 when some attempt returned 200 with the marker in the body AND the
# expected commit stamp. Exits 1 immediately on a 401/403: retrying cannot
# make an unobservable page observable, and #9624 is the record of what a
# "could not authenticate, skipping" branch does to a gate.
probe() {
  local url="$1" marker="$2" proves="$3"
  local attempt=0 http_code reported reported_short last="no attempt was made"

  while [ "$attempt" -lt "$RETRIES" ]; do
    attempt=$(( attempt + 1 ))
    echo "Probe attempt ${attempt}/${RETRIES}: ${url}"

    # Truncate first so a failed transfer can never leave the previous
    # attempt's (or the previous route's) body in place to be judged.
    : > "$RESPONSE_FILE"
    http_code=$(curl "${CURL_ARGS[@]}" \
      --output "$RESPONSE_FILE" \
      --write-out "%{http_code}" \
      "$url") || http_code="000"
    echo "  HTTP status: ${http_code}"

    if [ "$http_code" = "200" ]; then
      if ! grep -qF -- "$marker" "$RESPONSE_FILE" 2>/dev/null; then
        last="HTTP 200 but the body does not contain ${marker} — ${proves} is missing, so this is the empty or zero-command page, not a healthy one"
        echo "::warning::${last}"
      else
        echo "  Content check passed: found ${marker} (${proves})"
        reported="$(commit_of_body "$RESPONSE_FILE")"
        reported_short="${reported,,}"
        reported_short="${reported_short:0:$COMMIT_COMPARE_WIDTH}"
        if [ -z "$reported" ]; then
          last="HTTP 200 with the content, but the page reported no commit (no hex <meta name=\"${COMMIT_META_NAME}\"> stamp), so it cannot be tied to the deploy under test — an older build, or one built without VERCEL_GIT_COMMIT_SHA. That variable reaches a Vercel build ONLY when the docs project has 'Automatically expose System Environment Variables' enabled (Vercel Dashboard > spawnforge-docs > Settings > Advanced; see docs/production-support.md section 13 and apps/docs/README.md). If this fails on every attempt of a fresh deploy, check that toggle before suspecting alias lag — retrying cannot turn it on"
          echo "::warning::${last}"
        elif [ "$reported_short" != "$EXPECT_COMMIT_SHORT" ]; then
          last="HTTP 200 with the content, but the page reports commit ${reported_short}, expected ${EXPECT_COMMIT_SHORT} — the alias is serving a DIFFERENT build (alias assignment lag, or a deploy whose domain set did not include this alias), not the one this run published"
          echo "::warning::${last}"
        else
          echo "  Commit check passed: page reports ${reported_short}"
          return 0
        fi
      fi
    elif [ "$http_code" = "401" ] || [ "$http_code" = "403" ]; then
      echo "::error::HTTP ${http_code} from ${url}: the production alias refused the probe, so the page cannot be observed from here. This is protection on the ALIAS itself, not the deployment-URL SSO (this gate never probes a deployment URL): Vercel Firewall / Attack Challenge Mode, a WAF rule, or 'Protect Production' Deployment Protection answering the CI runner. Allow the runner (a firewall allow rule, or turn Protect Production off for the docs project) and re-run; do not skip this gate." >&2
      exit 1
    else
      last="${url} returned HTTP ${http_code}"
      echo "::warning::${last}"
      head -c 512 "$RESPONSE_FILE" 2>/dev/null || true
      echo ""
    fi

    if [ "$attempt" -lt "$RETRIES" ]; then
      echo "  Retrying in ${INTERVAL}s..."
      sleep "$INTERVAL"
    fi
  done

  echo "::error::${url} did not return 200 with ${marker} from commit ${EXPECT_COMMIT_SHORT} after ${RETRIES} attempt(s) — ${proves} could not be verified on the deployed docs site. Last attempt: ${last}" >&2
  return 1
}

# ---------- run -------------------------------------------------------------

echo "Waiting ${STABILIZE}s for the docs deployment to stabilize: ${BASE_URL} (expecting commit ${EXPECT_COMMIT_SHORT})"
sleep "$STABILIZE"

if ! probe "$INDEX_URL" "$INDEX_MARKER" "a category tile, i.e. more than zero public commands"; then
  exit 1
fi
if ! probe "$CATEGORY_URL" "$CATEGORY_MARKER" "the ${COMMAND} command rendered under ${CATEGORY}"; then
  exit 1
fi

echo "Docs MCP reference check passed: ${INDEX_URL} lists categories and ${CATEGORY_URL} renders ${COMMAND}, both from commit ${EXPECT_COMMIT_SHORT}"
exit 0
