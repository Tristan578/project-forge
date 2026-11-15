#!/usr/bin/env bash
# post-deploy-capability-matrix-check.sh
#
# Verifies that a deployed docs site RENDERS the capability matrix at
# /capability-matrix — a table with the marker row in it — not merely that
# the route answers 200.
#
# WHY THIS PROBE EXISTS (#9720)
#
# The page is rendered from a statically imported JSON copy of
# docs/capability-matrix.md. The first cut read that copy with fs.readFileSync
# from a __dirname-derived path at request time — byte-for-byte the loader that
# 500'd /mcp in production for weeks while every local test stayed green
# (#9718): Next.js output file tracing ships only module edges, so the file
# never reached /var/task. Nothing short of the deployed artifact can observe
# output file tracing, so the deploy is the place to look. And the failure
# shape is a 200: the page renders an explicit "carries no rows" notice
# (role="alert") when the copy is empty, so a status-only probe would pass it
# (lessons-learned #1 — assert the property a reader depends on).
#
# Usage:
#   bash scripts/post-deploy-capability-matrix-check.sh <base-url>
#
# Arguments:
#   base-url   Docs origin, no trailing slash needed (https://docs.spawnforge.ai).
#              The public domain is unprotected, so no bypass is normally needed.
#
# Environment variables (all optional):
#   MATRIX_CHECK_RETRIES       Attempts before declaring failure (default: 3)
#   MATRIX_CHECK_INTERVAL_S    Seconds between attempts (default: 10)
#   MATRIX_CHECK_STABILIZE_S   Seconds to wait before the first attempt (default: 30)
#   MATRIX_CHECK_TIMEOUT_S     curl max-time per request in seconds (default: 15)
#   MATRIX_CHECK_EXPECT_ROW    Row key that must be rendered as a table cell
#                              (default: commands:scene — a row the matrix has
#                              carried since it was first published; the docs
#                              artifact test pins the same marker).
#   VERCEL_AUTOMATION_BYPASS   Deployment Protection bypass secret, sent as the
#                              x-vercel-protection-bypass HEADER (never a query
#                              parameter — those land in logs).
#
# Exit codes:
#   0  The page rendered the matrix with the marker row.
#   1  Anything else — non-200, redirect, empty body, the no-rows notice, a
#      table without the marker row, or an unreachable host — after all
#      retries. There is no warn-and-continue path.

set -euo pipefail

DEPLOY_URL="${1:-}"
if [[ -z "$DEPLOY_URL" ]]; then
  echo "::error::Usage: $0 <base-url>"
  exit 1
fi
DEPLOY_URL="${DEPLOY_URL%/}"

RETRIES="${MATRIX_CHECK_RETRIES:-3}"
INTERVAL="${MATRIX_CHECK_INTERVAL_S:-10}"
STABILIZE="${MATRIX_CHECK_STABILIZE_S:-30}"
TIMEOUT="${MATRIX_CHECK_TIMEOUT_S:-15}"
EXPECT_ROW="${MATRIX_CHECK_EXPECT_ROW:-commands:scene}"

PAGE_URL="${DEPLOY_URL}/capability-matrix"
# TEST SEAM: the suite points this at a scratch file.
RESPONSE_FILE="${MATRIX_RESPONSE_FILE:-$(mktemp)}"

# No --location: a sign-in redirect (the proxy's default for a route dropped
# from PUBLIC_ROUTES) must stay a 307 and fail, not be followed to a 200
# sign-in page.
CURL_ARGS=(--silent --show-error --max-time "$TIMEOUT")
if [ -n "${VERCEL_AUTOMATION_BYPASS:-}" ]; then
  CURL_ARGS+=(-H "x-vercel-protection-bypass: ${VERCEL_AUTOMATION_BYPASS}")
fi

# check_capability_matrix_body <http-code> <body-file>
#
# The property a reader depends on: the response is a 200 whose body carries
# the marker row rendered as a table cell. CapabilityMatrixDocument emits the
# row key as an inline-code node directly inside the row's first cell — a
# <th scope="row">, because the row key is what the row is ABOUT (WCAG 1.3.1)
# — and scope="col" on every header cell, so both are asserted on the SSR
# output. Both regexes below are EXTRACTED and replayed against the real
# renderToStaticMarkup output by
# apps/docs/components/__tests__/CapabilityMatrixDocument.test.tsx, so a
# markup change breaks CI here rather than CD there.
# Returns 1 with a ::error:: line for every other shape.
check_capability_matrix_body() {
  local code="$1" file="$2"
  local expect="${MATRIX_CHECK_EXPECT_ROW:-commands:scene}"

  if [ "$code" != "200" ]; then
    echo "::error::${PAGE_URL:-/capability-matrix} answered HTTP ${code}, not 200 (a 307 is the sign-in redirect for a route missing from proxy.ts PUBLIC_ROUTES; 000 is unreachable)"
    return 1
  fi
  if [ ! -s "$file" ]; then
    echo "::error::${PAGE_URL:-/capability-matrix} answered 200 with an empty body"
    return 1
  fi
  if grep -q 'role="alert"' "$file"; then
    echo "::error::${PAGE_URL:-/capability-matrix} rendered its no rows notice — the shipped data/capability-matrix.json carries no matrix rows (the #9718 shape: the artifact is missing or empty in the deployed function)"
    return 1
  fi
  if ! grep -q '<th[^>]*scope="col"' "$file"; then
    echo "::error::${PAGE_URL:-/capability-matrix} answered 200 but rendered no data table (no <th scope=\"col\">)"
    return 1
  fi
  if ! grep -Eq "<th[^>]*><code[^>]*>${expect}</code>" "$file"; then
    echo "::error::${PAGE_URL:-/capability-matrix} rendered a table without the marker row \`${expect}\` as a cell (set MATRIX_CHECK_EXPECT_ROW if the row was renamed — and update the docs artifact test in the same PR)"
    return 1
  fi
  return 0
}

echo "Capability matrix check: ${PAGE_URL} (marker row: ${EXPECT_ROW})"
if [ "$STABILIZE" -gt 0 ]; then
  echo "Waiting ${STABILIZE}s for the deployment to stabilize..."
  sleep "$STABILIZE"
fi

for attempt in $(seq 1 "$RETRIES"); do
  echo "Attempt ${attempt}/${RETRIES}..."
  # The `||` belongs to the ASSIGNMENT, not to the command substitution. On an
  # unreachable host curl writes its own `%{http_code}` of 000 to stdout AND
  # exits non-zero, so `$(curl ... || echo 000)` captures BOTH and the value
  # becomes the two-line string "000\n000" — the diagnostic then reads
  # "answered HTTP 000\n000, not 200". Assignment-level `||` REPLACES instead,
  # which is what the sibling scripts/post-deploy-health-check.sh does.
  code="$(curl "${CURL_ARGS[@]}" --output "$RESPONSE_FILE" --write-out '%{http_code}' "$PAGE_URL")" || code="000"
  if check_capability_matrix_body "$code" "$RESPONSE_FILE"; then
    echo "Capability matrix check passed: ${PAGE_URL} renders the matrix with row \`${EXPECT_ROW}\`."
    exit 0
  fi
  if [ "$attempt" -lt "$RETRIES" ]; then
    echo "Retrying in ${INTERVAL}s..."
    sleep "$INTERVAL"
  fi
done

echo "::error::Capability matrix check failed after ${RETRIES} attempts: ${PAGE_URL} does not render the matrix. The page README, robots.ts and sitemap.ts advertise is broken for readers."
exit 1
