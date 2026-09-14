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
#   GET    /projects/{project_id}/branches/{branch_id}/roles/{role}/reveal_password
#                                                           compose a URI when
#                                                           the create response
#                                                           carried none
#   GET    /projects/{project_id}/operations/{operation_id}  poll create to done
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
#       Deletes the branch and waits for the deletion's operations to finish,
#       so a create issued right after it is not refused for a branch Neon is
#       still counting.
#   prune <name-prefix> <retention-days>
#       Deletes branches whose name starts with <name-prefix> and which are
#       older than <retention-days>. Housekeeping only. Waits like delete.
#   list <name-prefix>
#       Prints id<TAB>name<TAB>created_at for every branch whose name starts
#       with <name-prefix>, OLDEST FIRST, and nothing at all when none match.
#       An empty prefix lists the whole project. Read-only: this is the audit
#       view scripts/preview-db-branch.sh reclaims capacity from (#10015).
#
# ENVIRONMENT
#   NEON_API_KEY      (required)
#   NEON_PROJECT_ID   (required)
#   NEON_DATABASE     Optional. Names which database to connect the dry run to
#                     when the new branch carries more than one. Only consulted
#                     on the compose path below.
#   NEON_ROLE         Optional. Same, for the role.
#   NEON_POLL_INTERVAL_SECONDS   Optional, default 2. Gap between operation polls.
#   NEON_POLL_TIMEOUT_SECONDS    Optional, default 120. Give up on an operation
#                     after this long and exit 4. Matches scripts/pitr-verify.mjs.
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
#   4   a branch-creation operation did not finish inside the poll timeout
#   5   Neon refused to CREATE because the project's branch allowance is full
#       (body code BRANCHES_LIMIT_EXCEEDED). Distinct from 3 so a caller can
#       reclaim capacity and retry instead of grepping a message (#10015).
#   64  usage error
set -uo pipefail

NEON_API_BASE='https://console.neon.tech/api/v2'
USAGE='usage: neon-branch.sh create <name> [--endpoint] [--uri-out <path>]
       neon-branch.sh delete <branch_id>
       neon-branch.sh prune <name-prefix> <retention-days>
       neon-branch.sh list <name-prefix>'

command -v jq >/dev/null 2>&1 || { echo "::error::neon-branch.sh requires jq"; exit 3; }

CURL="${NEON_CURL_CMD:-curl}"

: "${NEON_API_KEY:=}"
: "${NEON_PROJECT_ID:=}"
: "${NEON_DATABASE:=}"
: "${NEON_ROLE:=}"
: "${NEON_POLL_INTERVAL_SECONDS:=2}"
: "${NEON_POLL_TIMEOUT_SECONDS:=120}"
if [ -z "$NEON_API_KEY" ] || [ -z "$NEON_PROJECT_ID" ]; then
  echo "::error::NEON_API_KEY and NEON_PROJECT_ID must both be set."
  echo "::error::A production schema migration is not permitted without a pre-migration snapshot."
  exit 2
fi

# Perform one Neon API call. Echoes the response body on 2xx; returns 3
# otherwise, or 5 when the error body names BRANCHES_LIMIT_EXCEEDED.
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
      # A full branch allowance is the one failure a caller can do something
      # about (delete a branch, retry), so it gets its own code. Neon names it
      # in the body: {"code":"BRANCHES_LIMIT_EXCEEDED",...} on a 422 (#10015).
      if [ "$(jq -r '.code // empty' <<<"$payload" 2>/dev/null)" = "BRANCHES_LIMIT_EXCEEDED" ]; then
        return 5
      fi
      return 3
      ;;
  esac
}

# Block until every operation the create-branch response opened has finished.
#
# Creating a branch is ASYNCHRONOUS. The 201 means Neon accepted the request,
# not that the branch -- and in particular its compute endpoint -- exists yet:
# the response carries an `operations` array (`create_branch`, `start_compute`)
# whose members are still `running` or `scheduling`. Handing the connection URI
# straight to drizzle-kit therefore races provisioning, and the loser is a
# connection error in the migration dry run that reads exactly like a bad
# migration. That is the worst possible shape for this failure: the dry run is
# the gate that decides whether a schema change reaches production, so a
# spurious red here either blocks a good deploy or trains whoever is on the
# other end to re-run it until it passes.
#
# scripts/pitr-verify.mjs already polls the same endpoint with the same
# semantics (finished / failed|error|cancelled / timeout at exit 4); this is
# that logic in bash, sharing the interval and timeout defaults so the two
# agree about how long "too long" is.
#
# A response with no `operations` (any list/delete call, and every fixture that
# predates this) waits for nothing and returns immediately.
neon_wait_for_operations() {
  local resp="$1"
  local ids id waited status op_resp interval timeout

  ids="$(jq -r '(.operations // []) | map(.id // empty) | .[]' <<<"$resp" 2>/dev/null)"
  [ -n "$ids" ] || return 0

  # A zero or non-numeric interval would spin the loop against the Neon API
  # without ever advancing `waited`, so the timeout below could never fire.
  interval="$NEON_POLL_INTERVAL_SECONDS"
  case "$interval" in ''|*[!0-9]*|0) interval=2 ;; esac
  timeout="$NEON_POLL_TIMEOUT_SECONDS"
  case "$timeout" in ''|*[!0-9]*) timeout=120 ;; esac

  while read -r id; do
    [ -n "$id" ] || continue
    waited=0
    while :; do
      op_resp="$(neon_api GET "/projects/${NEON_PROJECT_ID}/operations/${id}")" || return 3
      status="$(jq -r '.operation.status // empty' <<<"$op_resp" 2>/dev/null)"
      case "$status" in
        finished) break ;;
        failed|error|cancelled)
          echo "::error::Neon operation ${id} ended with status '${status}'; the branch is not usable." >&2
          return 3 ;;
      esac
      if [ "$waited" -ge "$timeout" ]; then
        echo "::error::Neon operation ${id} did not finish within ${timeout}s (last status '${status:-none}')." >&2
        return 4
      fi
      sleep "$interval"
      waited=$(( waited + interval ))
    done
  done <<<"$ids"
}

# URL-encode one component of a connection URI. A Neon role password is a
# generated string that can legitimately contain `@`, `/`, `#`, `?` or `:` --
# each of which silently re-parses the URI into a different host, path or query
# if it is pasted in raw. Percent-encoding is not cosmetic here: an unescaped
# `@` sends the dry run at a host that is not the branch.
uri_escape() { jq -rn --arg s "$1" '$s | @uri'; }

# Pick the one database (or role) to connect as, from the arrays the
# create-branch response already carries.
#
# One candidate means there is nothing to decide. Several means there is, and
# guessing would be worse than stopping: rehearsing the migration against the
# wrong database exercises data nobody asked about and still reports a pass.
# $NEON_DATABASE / $NEON_ROLE name the intended one; without them the error
# lists what was actually found, so the fix is one variable away.
neon_pick_name() {
  local resp="$1" field="$2" want="$3" var="$4"
  local names count
  names="$(jq -r --arg f "$field" '(.[$f] // []) | map(.name // empty) | .[]' <<<"$resp" 2>/dev/null)"
  if [ -n "$want" ]; then
    if grep -qxF -- "$want" <<<"$names"; then printf '%s' "$want"; return 0; fi
    echo "::error::${var} is set to '${want}', but the new branch carries no such entry in ${field}. Found: $(tr '\n' ' ' <<<"$names")" >&2
    return 3
  fi
  count="$(grep -c . <<<"$names")"
  case "$count" in
    1) printf '%s' "$names"; return 0 ;;
    0) echo "::error::Neon create-branch response carried no ${field}; cannot compose a connection URI." >&2; return 3 ;;
    *) echo "::error::The new branch carries ${count} entries in ${field} and none was chosen. Set ${var} to one of: $(tr '\n' ' ' <<<"$names")" >&2
       return 3 ;;
  esac
}

# Compose the connection URI when the create response did not carry one, and
# write it into $dest.
#
# Neon omits `connection_uris` entirely whenever the PARENT branch has more than
# one role or database. That is documented on POST /projects/{id}/branches --
# "When creating a branch from a parent with more than one role or database, the
# response body does not include a connection URI" -- and it is an ordinary
# production shape, not a fault. Treating it as one (the previous behaviour: a
# bare exit 3) would hard-block every schema deploy on any project that ever
# grows a second database or role, which is exactly when a rehearsed migration
# matters most.
#
# Everything needed is already in the same response except the password, which
# is one documented GET away. The result goes straight into the 0600 file that
# the caller already created: it is never returned on stdout, so it cannot be
# spliced into a captured value or a job log. No ::add-mask:: is emitted either,
# deliberately -- that directive is only honoured on a GitHub runner, and
# printing the password to request masking is the one thing that would leak it
# anywhere else.
neon_compose_uri_into() {
  local dest="$1" resp="$2" branch_id="$3"
  local host db role pw_resp password

  host="$(jq -r '(.endpoints // []) | (map(select(.type == "read_write")) + .) | .[0].host // empty' <<<"$resp" 2>/dev/null)"
  if [ -z "$host" ]; then
    echo "::error::Neon create-branch response carried no connection_uris[0].connection_uri and no compute endpoint host to compose one from." >&2
    return 3
  fi

  db="$(neon_pick_name "$resp" databases "$NEON_DATABASE" NEON_DATABASE)" || return 3
  role="$(neon_pick_name "$resp" roles "$NEON_ROLE" NEON_ROLE)" || return 3

  pw_resp="$(neon_api GET "/projects/${NEON_PROJECT_ID}/branches/${branch_id}/roles/$(uri_escape "$role")/reveal_password")" || return 3
  password="$(jq -r '.password // empty' <<<"$pw_resp" 2>/dev/null)"
  if [ -z "$password" ]; then
    echo "::error::Neon revealed no password for role '${role}' on branch ${branch_id}; cannot compose a connection URI." >&2
    return 3
  fi

  printf 'postgresql://%s:%s@%s/%s?sslmode=require' \
    "$(uri_escape "$role")" "$(uri_escape "$password")" "$host" "$(uri_escape "$db")" > "$dest"
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
  # Propagate the API's own code: 5 (allowance full) is what the preview
  # policy reclaims-and-retries on; everything else stays 3.
  resp="$(neon_api POST "/projects/${NEON_PROJECT_ID}/branches" "$body")" || exit $?

  local branch_id
  branch_id="$(jq -r '.branch.id // empty' <<<"$resp" 2>/dev/null)"
  if [ -z "$branch_id" ]; then
    echo "::error::Neon create-branch response carried no branch.id — refusing to continue without a snapshot."
    exit 3
  fi

  # Before anything reads from the branch -- including the reveal_password call
  # on the compose path below, which can 404 while the branch is still being
  # created.
  neon_wait_for_operations "$resp" || exit $?

  if [ -n "$uri_out" ]; then
    local uri
    uri="$(jq -r '.connection_uris[0].connection_uri // empty' <<<"$resp" 2>/dev/null)"
    # Create the file empty-and-private BEFORE writing the secret into it.
    : > "$uri_out"
    chmod 600 "$uri_out"
    if [ -n "$uri" ]; then
      printf '%s' "$uri" > "$uri_out"
    else
      neon_compose_uri_into "$uri_out" "$resp" "$branch_id" || exit 3
    fi
  fi

  echo "branch_id=${branch_id}"
  echo "branch_name=${name}"
}

cmd_delete() {
  local branch_id="${1:-}" resp
  [ -n "$branch_id" ] || { echo "::error::$USAGE"; exit 64; }
  resp="$(neon_api DELETE "/projects/${NEON_PROJECT_ID}/branches/${branch_id}")" || exit 3
  # Deleting is asynchronous like creating: the 200 carries `operations`
  # (delete_timeline, suspend_compute) that may still be running, and until
  # they finish the branch can still count against the allowance a caller is
  # about to retry a create against (#10015). Wait, exactly as create does.
  neon_wait_for_operations "$resp" || exit $?
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
  # Neon emits second-precision timestamps; fractional seconds are tolerated
  # so a format change cannot silently turn every branch into "not stale".
  stale="$(jq -r --arg p "$prefix" --argjson c "$cutoff" '
      (.branches // [])
      | map(select((.name // "") | startswith($p)))
      | map(select(((.created_at // "1970-01-01T00:00:00Z") | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) < $c))
      | .[].id
    ' <<<"$resp" 2>/dev/null)"

  if [ -z "$stale" ]; then
    echo "pruned=0"
    return 0
  fi

  local n=0 id resp_del
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    if resp_del="$(neon_api DELETE "/projects/${NEON_PROJECT_ID}/branches/${id}")"; then
      # Same asynchrony as cmd_delete; a caller that creates right after a
      # prune (the preview job replacing its own branch) must not race it.
      neon_wait_for_operations "$resp_del" || echo "::warning::deletion of ${id} was accepted but its operations had not finished when polling stopped"
      echo "pruned_branch=${id}"
      n=$(( n + 1 ))
    else
      # Housekeeping must never fail a deploy that already succeeded.
      echo "::warning::could not delete stale snapshot branch ${id}"
    fi
  done <<<"$stale"
  echo "pruned=${n}"
}

cmd_list() {
  [ $# -eq 1 ] || { echo "::error::$USAGE"; exit 64; }
  local prefix="$1" resp
  resp="$(neon_api GET "/projects/${NEON_PROJECT_ID}/branches")" || exit 3
  # Oldest first: the preview policy evicts the FIRST row it may, so the order
  # is part of the contract. Prints nothing when nothing matches; a failed
  # list is the exit 3 above, never an empty success.
  #
  # `tr -d '\r'`: jq.exe on Windows opens stdout in text mode and terminates
  # every line with CRLF (the same quirk scripts/check-openapi-route-sync.sh
  # normalises). A row ending in "Z\r" is not the TSV promised above -- the
  # consumer's date parse fails on it and that row is silently never evicted --
  # so the CR is stripped at the one point rows leave this script. pipefail
  # keeps a jq failure visible through the pipe.
  jq -r --arg p "$prefix" '
      (.branches // [])
      | map(select((.name // "") | startswith($p)))
      | sort_by(.created_at // "")
      | .[]
      | [.id, (.name // ""), (.created_at // "")]
      | @tsv
    ' <<<"$resp" 2>/dev/null | tr -d '\r' \
    || { echo "::error::Neon list-branches response could not be parsed." >&2; exit 3; }
}

case "${1:-}" in
  create) shift; cmd_create "$@" ;;
  delete) shift; cmd_delete "$@" ;;
  prune)  shift; cmd_prune  "$@" ;;
  list)   shift; cmd_list   "$@" ;;
  *) echo "::error::$USAGE"; exit 64 ;;
esac
