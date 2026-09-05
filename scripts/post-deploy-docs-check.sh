#!/usr/bin/env bash
# post-deploy-docs-check.sh
#
# Post-deploy smoke check for the docs site's MCP command reference. Probes the
# two routes that render `data/commands.json` and fails on anything short of a
# populated page.
#
# Usage:
#   bash scripts/post-deploy-docs-check.sh <base-url>
#
# Arguments:
#   base-url   Origin to probe, no trailing slash (https://docs.spawnforge.ai).
#              cd.yml passes the production alias: the Vercel deployment URL is
#              behind Deployment Protection and cannot be observed from here,
#              and the alias is what readers load.
#
# Environment variables (all optional):
#   DOCS_CHECK_CATEGORY      Category page to probe (default: scene)
#   DOCS_CHECK_COMMAND       Command name that must be rendered on that page
#                            (default: spawn_entity). Keep in step with
#                            apps/docs/lib/__tests__/commandsManifestArtifact.test.ts,
#                            which pins the same pair against the manifest.
#   DOCS_CHECK_RETRIES       Attempts per route before failing (default: 3)
#   DOCS_CHECK_INTERVAL_S    Seconds between attempts (default: 10)
#   DOCS_CHECK_STABILIZE_S   Seconds to wait before the first probe (default: 30)
#   DOCS_CHECK_TIMEOUT_S     curl max-time per request (default: 15)
#
# Exit codes:
#   0  Both routes returned 200 with the expected content
#   1  Any route was non-200, unobservable (Deployment Protection), or 200 with
#      the content missing — the deploy is not verified.
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

set -euo pipefail

# ---------- arguments & defaults ------------------------------------------

BASE_URL="${1:-}"
if [[ -z "$BASE_URL" ]]; then
  echo "::error::Usage: $0 <base-url>"
  exit 1
fi
BASE_URL="${BASE_URL%/}"

CATEGORY="${DOCS_CHECK_CATEGORY:-scene}"
COMMAND="${DOCS_CHECK_COMMAND:-spawn_entity}"
RETRIES="${DOCS_CHECK_RETRIES:-3}"
INTERVAL="${DOCS_CHECK_INTERVAL_S:-10}"
STABILIZE="${DOCS_CHECK_STABILIZE_S:-30}"
TIMEOUT="${DOCS_CHECK_TIMEOUT_S:-15}"

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

# ---------- one route, with retries ---------------------------------------
#
# probe <url> <marker> <what-the-marker-proves>
# Returns 0 when some attempt returned 200 with the marker in the body.
# Exits 1 immediately on a Deployment Protection answer: retrying cannot make
# an unobservable deployment observable, and #9624 is the record of what a
# "could not authenticate, skipping" branch does to a gate.
probe() {
  local url="$1" marker="$2" proves="$3"
  local attempt=0 http_code

  while [ "$attempt" -lt "$RETRIES" ]; do
    attempt=$(( attempt + 1 ))
    echo "Probe attempt ${attempt}/${RETRIES}: ${url}"

    http_code=$(curl "${CURL_ARGS[@]}" \
      --output "$RESPONSE_FILE" \
      --write-out "%{http_code}" \
      "$url") || http_code="000"
    echo "  HTTP status: ${http_code}"

    if [ "$http_code" = "200" ]; then
      if grep -qF -- "$marker" "$RESPONSE_FILE" 2>/dev/null; then
        echo "  Content check passed: found ${marker} (${proves})"
        return 0
      fi
      echo "::warning::HTTP 200 but the body does not contain ${marker} — ${proves} is missing, so this is the empty or zero-command page, not a healthy one"
    elif [ "$http_code" = "401" ] || [ "$http_code" = "403" ]; then
      echo "::error::Deployment Protection answered the probe for ${url} (HTTP ${http_code}). The deployment cannot be observed from here; probe the public alias, not the deployment URL." >&2
      exit 1
    else
      echo "::warning::${url} returned HTTP ${http_code}"
      head -c 512 "$RESPONSE_FILE" 2>/dev/null || true
      echo ""
    fi

    if [ "$attempt" -lt "$RETRIES" ]; then
      echo "  Retrying in ${INTERVAL}s..."
      sleep "$INTERVAL"
    fi
  done

  echo "::error::${url} did not return 200 with ${marker} after ${RETRIES} attempt(s) — ${proves} could not be verified on the deployed docs site" >&2
  return 1
}

# ---------- run -------------------------------------------------------------

echo "Waiting ${STABILIZE}s for the docs deployment to stabilize: ${BASE_URL}"
sleep "$STABILIZE"

if ! probe "$INDEX_URL" "$INDEX_MARKER" "a category tile, i.e. more than zero public commands"; then
  exit 1
fi
if ! probe "$CATEGORY_URL" "$CATEGORY_MARKER" "the ${COMMAND} command rendered under ${CATEGORY}"; then
  exit 1
fi

echo "Docs MCP reference check passed: ${INDEX_URL} lists categories and ${CATEGORY_URL} renders ${COMMAND}"
exit 0
