#!/usr/bin/env bash
# Neon branch helper for the deploy pipeline (#9456).
#
# WHY THIS EXISTS
# ---------------
# `.github/workflows/cd.yml` mutates the production database before the new code
# deploys. Two things have to happen around that mutation:
#
#   1. A retained, pre-migration snapshot must exist, so a bad schema change is
#      recoverable. A Neon branch IS that snapshot: it is a copy-on-write clone
#      of the parent branch at the instant it is created.
#   2. The migration must first be rehearsed somewhere that is not production. A
#      second, throwaway branch with a read_write endpoint gives a real copy of
#      production data to push against, then gets deleted.
#
# API SURFACE (all verified against https://api-docs.neon.tech, and the create /
# delete / operation-poll calls are already exercised in-repo by
# scripts/pitr-verify.mjs):
#   POST   /projects/{project_id}/branches                  create
#   GET    /projects/{project_id}/branches                  list  (prune)
#   DELETE /projects/{project_id}/branches/{branch_id}      delete
# `endpoints` is optional on create ("If omitted, the branch is created without
# any compute endpoint"); endpoint `type` is `read_write` or `read_only`.
#
# The restore endpoint (POST /projects/{id}/branches/{id}/restore, body
# {"source_branch_id": ...}) is deliberately NOT called from here. Restoring
# production is a human decision; the runbook
# docs/operations/deploy-migration-rollback.md carries the exact command.
#
# SUBCOMMANDS
#   create <name> [--endpoint] [--uri-out <path>]
#       Creates a branch off the project's default branch. With --endpoint a
#       read_write compute is attached and its connection URI is written to
#       <path> (mode 600) — never to stdout, so it cannot land in a job log
#       before the caller has masked it.
#       Prints: branch_id=<id> / branch_name=<name>
#   delete <branch_id>
#   prune <name-prefix> <retention-days>
#       Deletes branches whose name starts with <name-prefix> and which are
#       older than <retention-days>. Housekeeping only.
#
# ENVIRONMENT
#   NEON_API_KEY      (required)
#   NEON_PROJECT_ID   (required)
#   NEON_CURL_CMD     TEST-ONLY seam. Overrides the `curl` binary so
#                     scripts/__tests__/neon-branch.test.sh can exercise every
#                     branch hermetically. CI NEVER sets this; the suite carries
#                     a static scan plus an unconditional runtime assertion that
#                     fails if it is ever set outside the self-test child.
#
# EXIT CODES
#   0   success
#   2   missing NEON_API_KEY / NEON_PROJECT_ID
#   3   Neon API error (non-2xx, unparseable body, or a missing expected field)
#   64  usage error
set -uo pipefail

NEON_API_BASE='https://console.neon.tech/api/v2'
USAGE='usage: neon-branch.sh create <name> [--endpoint] [--uri-out <path>]
       neon-branch.sh delete <branch_id>
       neon-branch.sh prune <name-prefix> <retention-days>'

command -v jq >/dev/null 2>&1 || { echo "::error::neon-branch.sh requires jq"; exit 3; }

CURL="${NEON_CURL_CMD:-curl}"

: "${NEON_API_KEY:=}"
: "${NEON_PROJECT_ID:=}"
if [ -z "$NEON_API_KEY" ] || [ -z "$NEON_PROJECT_ID" ]; then
  echo "::error::NEON_API_KEY and NEON_PROJECT_ID must both be set."
  echo "::error::A production schema migration is not permitted without a pre-migration snapshot."
  exit 2
fi

# Perform one Neon API call. Echoes the response body on 2xx; returns 3 otherwise.
# The body goes to a temp file via -o and ONLY the status code reaches stdout, so
# curl's own diagnostics can never be spliced into the payload (which would let a
# transport failure masquerade as a valid response).
neon_api() {
  local method="$1" path="$2" body="${3:-}"
  local status payload tmp
  tmp="$(mktemp)" || { echo "::error::mktemp failed" >&2; return 3; }
  # shellcheck disable=SC2086
  # $CURL is intentionally word-split: it is a command line, not a filename. It
  # comes from this repo (default `curl`, or the test-only $NEON_CURL_CMD seam),
  # never from PR content or any other untrusted source.
  if [ -n "$body" ]; then
    status="$($CURL -sS -X "$method" "${NEON_API_BASE}${path}" \
      -H "Authorization: Bearer ${NEON_API_KEY}" \
      -H 'Content-Type: application/json' \
      -H 'Accept: application/json' \
      -o "$tmp" -w '%{http_code}' \
      --data "$body" 2>/dev/null)"
  else
    status="$($CURL -sS -X "$method" "${NEON_API_BASE}${path}" \
      -H "Authorization: Bearer ${NEON_API_KEY}" \
      -H 'Accept: application/json' \
      -o "$tmp" -w '%{http_code}' 2>/dev/null)"
  fi
  payload="$(cat "$tmp" 2>/dev/null)"
  rm -f "$tmp"
  case "$status" in
    2*) printf '%s' "$payload"; return 0 ;;
    *)
      # Never echo $payload wholesale on failure. A Neon error body can echo
      # request content back, and anything printed here lands verbatim in a job
      # log that every repo reader can see. Two mitigations, both pinned by
      # scripts/__tests__/neon-branch.test.sh: redact connection URIs, then cap
      # the excerpt so a large body cannot bury the status line either.
      local excerpt
      excerpt="$(sed -E 's#postgres(ql)?://[^"[:space:]]*#postgres://REDACTED#g' <<<"${payload:0:300}")"
      echo "::error::Neon API ${method} ${path} failed with status '${status:-none}'." >&2
      echo "::error::${excerpt}" >&2
      return 3
      ;;
  esac
}

cmd_create() {
  local name="" want_endpoint=0 uri_out=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --endpoint) want_endpoint=1; shift ;;
      --uri-out) uri_out="${2:-}"; [ -n "$uri_out" ] || { echo "::error::--uri-out needs a path"; exit 64; }; shift 2 ;;
      -*) echo "::error::unknown flag '$1'"; echo "$USAGE"; exit 64 ;;
      *) [ -z "$name" ] || { echo "::error::$USAGE"; exit 64; }; name="$1"; shift ;;
    esac
  done
  [ -n "$name" ] || { echo "::error::$USAGE"; exit 64; }
  [ "$want_endpoint" -eq 1 ] || [ -z "$uri_out" ] || {
    echo "::error::--uri-out requires --endpoint (a branch with no compute has no connection URI)"; exit 64; }

  local body
  if [ "$want_endpoint" -eq 1 ]; then
    body="$(jq -nc --arg n "$name" '{branch: {name: $n}, endpoints: [{type: "read_write"}]}')"
  else
    body="$(jq -nc --arg n "$name" '{branch: {name: $n}}')"
  fi

  local resp
  resp="$(neon_api POST "/projects/${NEON_PROJECT_ID}/branches" "$body")" || exit 3

  local branch_id
  branch_id="$(jq -r '.branch.id // empty' <<<"$resp" 2>/dev/null)"
  if [ -z "$branch_id" ]; then
    echo "::error::Neon create-branch response carried no branch.id — refusing to continue without a snapshot."
    exit 3
  fi

  if [ -n "$uri_out" ]; then
    local uri
    uri="$(jq -r '.connection_uris[0].connection_uri // empty' <<<"$resp" 2>/dev/null)"
    if [ -z "$uri" ]; then
      echo "::error::Neon create-branch response carried no connection_uris[0].connection_uri."
      exit 3
    fi
    # Create the file empty-and-private BEFORE writing the secret into it.
    : > "$uri_out"
    chmod 600 "$uri_out"
    printf '%s' "$uri" > "$uri_out"
  fi

  echo "branch_id=${branch_id}"
  echo "branch_name=${name}"
}

cmd_delete() {
  local branch_id="${1:-}"
  [ -n "$branch_id" ] || { echo "::error::$USAGE"; exit 64; }
  neon_api DELETE "/projects/${NEON_PROJECT_ID}/branches/${branch_id}" >/dev/null || exit 3
  echo "deleted=${branch_id}"
}

cmd_prune() {
  local prefix="${1:-}" days="${2:-}"
  [ -n "$prefix" ] || { echo "::error::$USAGE"; exit 64; }
  case "$days" in
    ''|*[!0-9]*) echo "::error::retention-days must be a non-negative integer, got '${days}'"; exit 64 ;;
  esac

  local resp cutoff stale
  resp="$(neon_api GET "/projects/${NEON_PROJECT_ID}/branches")" || exit 3
  cutoff=$(( $(date -u +%s) - days * 86400 ))
  stale="$(jq -r --arg p "$prefix" --argjson c "$cutoff" '
      (.branches // [])
      | map(select((.name // "") | startswith($p)))
      | map(select(((.created_at // "1970-01-01T00:00:00Z") | fromdateiso8601) < $c))
      | .[].id
    ' <<<"$resp" 2>/dev/null)"

  if [ -z "$stale" ]; then
    echo "pruned=0"
    return 0
  fi

  local n=0 id
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    if neon_api DELETE "/projects/${NEON_PROJECT_ID}/branches/${id}" >/dev/null; then
      echo "pruned_branch=${id}"
      n=$(( n + 1 ))
    else
      # Housekeeping must never fail a deploy that already succeeded.
      echo "::warning::could not delete stale snapshot branch ${id}"
    fi
  done <<<"$stale"
  echo "pruned=${n}"
}

case "${1:-}" in
  create) shift; cmd_create "$@" ;;
  delete) shift; cmd_delete "$@" ;;
  prune)  shift; cmd_prune  "$@" ;;
  *) echo "::error::$USAGE"; exit 64 ;;
esac
