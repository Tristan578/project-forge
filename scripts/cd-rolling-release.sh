#!/usr/bin/env bash
# cd-rolling-release.sh
#
# The three Rolling Release questions cd.yml's production deploy has to
# answer truthfully, and could not (#9624, #9625):
#
#   lkg                              Which deployment is serving production
#                                    RIGHT NOW? (the rollback target)
#   ensure-canary <deployment-url>   Is the deployment we just made the one a
#                                    verification step will actually observe?
#   superseded <deployment-url>      Before rolling back on a failed probe: does
#                                    a NEWER deployment own production, so the
#                                    probe failed because this run was
#                                    overtaken, not because the build is bad?
#
# WHY `vercel ls | grep READY` COULD NOT ANSWER THE FIRST
#
# The CLI prints `● Ready`, so the grep matched nothing and every run logged
# `Last-known-good production URL: unknown`; both rollback steps are guarded
# on that output being non-empty, so automatic rollback has never fired. And
# under Rolling Releases the newest READY production deployment is the CANARY,
# not the base — the live base is `rollingRelease.currentDeployment`.
#
# WHY THE SECOND QUESTION EXISTS AT ALL
#
# Vercel starts a rolling release when a production deployment becomes ready.
# But "if a rolling release is in progress when one of the promote actions
# triggers, the project's state won't change" (vercel.com/docs/rolling-releases):
# a deploy that lands while an older canary is still ramping is simply never
# rolled out. Measured live on 2026-09-02: main @ 8aee29f9 deployed at 04:09
# UTC, reported success, and never served a byte — the 03:45 canary was still
# active, and the 04:34 deploy became the next canary instead. So after
# `vercel deploy --prod` the pipeline must establish that its deployment is
# the canary (or already current) before verifying anything, or it verifies
# a different build.
#
# Main is linear, so a newer deployment is a superset of any older canary it
# finds ramping. That older canary is therefore aborted (Instant Rollback to
# the base it was ramping from — no verified build is lost) and this
# deployment is started in its place — ONCE. The reverse case — an older run
# finding a NEWER canary — is a superseded run and fails loudly; it must not
# touch the rollout. A canary whose age cannot be read is refused as well:
# older-or-newer is the whole decision, and the wrong guess aborts a newer
# build's rollout.
#
# THE ABORT HAS A SIDE EFFECT
#
# The only way to stop an active rollout through the API is the project
# rollback endpoint (vercel.com/docs/rolling-releases, "Stopping a rolling
# release with the API"), and it leaves the project in a ROLLED-BACK STATE:
# auto-assignment of production domains is off, so pushes to main no longer go
# live by themselves, until a rolling release completes
# (vercel.com/docs/instant-rollback#undo-a-rollback). The `start` that follows
# the abort here re-enters a rollout, and completing it exits that state. If
# that start is refused, production is serving the BASE with auto-assign off
# and nothing will change it — so a refused start after an abort is a hard
# error naming the base, never a warning. `disposition` (below) is written to
# GITHUB_OUTPUT so cd.yml can tell "refused, untouched" from "aborted, then
# failed" and roll back / open the incident for the latter.
#
# WHY `superseded` EXISTS
#
# cd.yml serialises production deploys (its concurrency group does not cancel
# a running deploy), so two merges to main never verify at the same time. An
# OUT-OF-BAND deploy can: a manual `vercel deploy --prod`, or a
# `promote_to_production` dispatch on another ref, which lands in a different
# concurrency group. Then the newer deploy's ensure-canary aborts this run's
# still-ramping rollout, the forced `_vcrr_` cookie "is good only for the
# duration of a single rolling release", and this run's probe lands on the
# base or on the newer canary — the commit assertion trips. That is not an
# unhealthy build. If this run then rolled back, it would Instant-Rollback
# production to its own base and abort the newer, healthy rollout, whose
# probe would fail and roll back in turn. So before a rollback, cd.yml asks
# this question and skips the rollback (and the incident issue) when a newer
# deployment owns production. The answer is `superseded=true|false` plus
# `owner=<id>`; a lookup that cannot answer says `false` with a warning — a
# probe failure whose cause cannot be established is still rolled back.
#
# WHAT `disposition` TELLS cd.yml WHEN ensure-canary FAILS
#
# Not every failure exit is equal. Some prove this build is NOT serving (a
# foreign canary is active, ours is at most queued): `untouched`. Some mean
# this run changed production: `mutated` (the abort was issued). Some mean
# this run's own start was accepted, so its unverified canary may be ramping:
# `started`. And a transport error before or while polling proves nothing —
# auto-assign starts a rollout the moment a production deployment is READY
# ("call start again when auto-assign custom domains already started a
# rollout"), so the build may already be live: `unknown`. cd.yml rolls back to
# the pre-deploy `prev_url` and opens the incident on every failure except
# `untouched`; with the live stage schedule (5% for 10 minutes, no approval)
# an unverified canary otherwise reaches 100% with a red run as the only
# signal. `disposition` is written at entry (`unknown`) and rewritten as the
# run learns more; it is meaningful only when ensure-canary exits non-zero.
#
# THE RESPONSE SHAPE
#
# `GET /v1/projects/{id}/rolling-release` answers `{ "rollingRelease": {...} }`
# — every field (`state`, `currentDeployment`, `canaryDeployment`,
# `queuedDeploymentId`, `currentCanaryPercentage`, `activeStage`) sits UNDER
# that one key, and the key is `null` when the feature is enabled but nothing
# has rolled out yet (openapi.vercel.sh; the CLI's own `rolling-release fetch`
# destructures `{ rollingRelease }` before printing, which is how a first cut
# of this script came to read the fields at the top level and passed a suite
# whose fixtures made the same mistake). `LIVE_ACTIVE` in
# scripts/__tests__/cd-rolling-release.test.sh is a live read from 2026-09-02,
# and every fixture there carries the wrapper.
#
# Environment:
#   VERCEL_TOKEN VERCEL_TEAM_ID VERCEL_PROJECT_ID   required
#   VERCEL_API_URL        test seam (default https://api.vercel.com)
#   RR_POLL_ATTEMPTS      ensure-canary polling budget (default 20)
#   RR_POLL_INTERVAL_S    seconds between polls (default 6)
#   GITHUB_OUTPUT         when set: `lkg` appends prev_url=<url>;
#                         `ensure-canary` appends
#                         disposition=<unknown|untouched|started|mutated>
#                         (at entry, then whenever it learns more — the LAST
#                         value counts) and, on success,
#                         canary_state=<current|canary>; `superseded` appends
#                         superseded=<true|false> and owner=<deployment id>
#
# Exit codes: 0 answered; 1 could not answer / superseded / refused; 2 usage.
set -euo pipefail

cmd="${1:-}"
arg="${2:-}"

: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
: "${VERCEL_TEAM_ID:?VERCEL_TEAM_ID is required}"
: "${VERCEL_PROJECT_ID:?VERCEL_PROJECT_ID is required}"

api_base="${VERCEL_API_URL:-https://api.vercel.com}"
poll_attempts="${RR_POLL_ATTEMPTS:-20}"
poll_interval="${RR_POLL_INTERVAL_S:-6}"

# ---------- HTTP helpers --------------------------------------------------

# api <method> <path> [json-body]
# Sets API_STATUS and API_BODY. Deliberately NOT "prints the body": a caller
# doing `body=$(api ...)` would run it in a subshell and lose the status.
API_STATUS=""
API_BODY=""
API_TMP="$(mktemp)"
trap 'rm -f "$API_TMP"' EXIT
api() {
  local method="$1" path="$2" body="${3:-}"
  local sep='?'
  case "$path" in *\?*) sep='&' ;; esac
  local -a extra=()
  if [ -n "$body" ]; then
    extra=(-H 'Content-Type: application/json' -d "$body")
  fi
  # `${extra[@]+"${extra[@]}"}`: an empty array expanded plainly aborts under
  # set -u on bash 3.2 (macOS), and inside this function that abort would read
  # as a transport failure.
  if ! curl -sS -w '\n%{http_code}' -X "$method" \
      -H "Authorization: Bearer $VERCEL_TOKEN" \
      ${extra[@]+"${extra[@]}"} \
      "${api_base}${path}${sep}teamId=${VERCEL_TEAM_ID}" > "$API_TMP" 2>/dev/null; then
    API_STATUS=000
    API_BODY=""
    return 0
  fi
  API_STATUS=$(tail -1 "$API_TMP")
  API_BODY=$(sed '$d' "$API_TMP")
}

# jq that fails closed: a non-JSON body reads as empty, never as a value.
jqr() {
  local body="$1" filter="$2"
  printf '%s' "$body" | jq -r "$filter // empty" 2>/dev/null || true
}

# A createdAt is only usable as an age when it is a plain non-empty integer.
is_epoch() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

with_scheme() {
  local u="$1"
  case "$u" in
    '') printf '' ;;
    https://*|http://*) printf '%s' "${u%/}" ;;
    *) printf 'https://%s' "${u%/}" ;;
  esac
}

emit_output() {
  local key="$1" value="$2"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "${key}=${value}" >> "$GITHUB_OUTPUT"
  fi
}

# ---------- state readers --------------------------------------------------

# Reads GET /v1/projects/{id}/rolling-release and sets:
#   RR_STATUS  HTTP status
#   RR_KIND    active | idle | none | error
#              active: rollingRelease.state == ACTIVE
#              idle:   a rollingRelease document in any other state (COMPLETE,
#                      ABORTED, ...) — nothing is ramping
#              none:   rollingRelease is null, or the endpoint answers 404/400
#                      (feature not enabled): production is whatever the
#                      project's production target says
#              error:  any other status, or a body without the wrapper
#   RR_DOC     the unwrapped document (empty for none/error)
RR_STATUS=""
RR_KIND=""
RR_DOC=""
read_rolling_release() {
  api GET "/v1/projects/${VERCEL_PROJECT_ID}/rolling-release"
  RR_STATUS="$API_STATUS"
  RR_DOC=""
  case "$RR_STATUS" in
    200)
      local kind
      kind=$(printf '%s' "$API_BODY" | jq -r 'if (type == "object" and has("rollingRelease")) then (if .rollingRelease == null then "none" else "doc" end) else "error" end' 2>/dev/null || echo error)
      case "$kind" in
        none) RR_KIND=none ;;
        doc)
          RR_DOC=$(printf '%s' "$API_BODY" | jq -c '.rollingRelease' 2>/dev/null || true)
          if [ "$(jqr "$RR_DOC" '.state')" = "ACTIVE" ]; then RR_KIND=active; else RR_KIND=idle; fi
          ;;
        *) RR_KIND=error ;;
      esac
      ;;
    404|400) RR_KIND=none ;;
    *) RR_KIND=error ;;
  esac
}

rr_error_exit() {
  echo "::error::Rolling release lookup failed (HTTP ${RR_STATUS}): $(printf '%s' "$API_BODY" | head -c 300)" >&2
  exit 1
}

# Prints the url of the deployment the production target currently points at.
production_target_url() {
  api GET "/v9/projects/${VERCEL_PROJECT_ID}"
  if [ "$API_STATUS" != "200" ]; then
    echo "::error::Vercel project lookup failed (HTTP ${API_STATUS})" >&2
    return 1
  fi
  jqr "$API_BODY" '.targets.production.url'
}

# ---------- lkg -----------------------------------------------------------

cmd_lkg() {
  local url
  read_rolling_release
  case "$RR_KIND" in
    active)
      url=$(jqr "$RR_DOC" '.currentDeployment.url')
      if [ -z "$url" ]; then
        echo "::error::Rolling release is ACTIVE but reports no currentDeployment — refusing to guess a rollback target" >&2
        exit 1
      fi
      url=$(with_scheme "$url")
      echo "Last-known-good production URL: ${url} (rolling release ACTIVE — the base, not the canary)"
      emit_output prev_url "$url"
      printf '%s\n' "$url"
      return 0
      ;;
    error) rr_error_exit ;;
  esac

  # idle or none: the production target is the live deployment.
  url=$(production_target_url) || exit 1
  if [ -z "$url" ]; then
    echo "::error::Project reports no production target deployment — refusing to emit an empty rollback target" >&2
    exit 1
  fi
  url=$(with_scheme "$url")
  echo "Last-known-good production URL: ${url} (production target; rolling release ${RR_KIND})"
  emit_output prev_url "$url"
  printf '%s\n' "$url"
}

# ---------- ensure-canary --------------------------------------------------

# Resolves <url> -> "<id> <createdAt>".
deployment_identity() {
  local host="$1" id created
  host="${host#https://}"; host="${host#http://}"; host="${host%/}"
  api GET "/v13/deployments/${host}"
  if [ "$API_STATUS" != "200" ]; then
    echo "::error::Deployment lookup failed for ${host} (HTTP ${API_STATUS})" >&2
    return 1
  fi
  id=$(jqr "$API_BODY" '.id')
  created=$(jqr "$API_BODY" '.createdAt')
  if [ -z "$id" ] || ! is_epoch "$created"; then
    echo "::error::Deployment lookup for ${host} returned no id or a non-numeric createdAt (${created:-<empty>})" >&2
    return 1
  fi
  printf '%s %s\n' "$id" "$created"
}

# Returns non-zero on a non-2xx so the caller decides how loud to be: before
# any mutation a refused start is a warning (auto-assign may already have
# started the rollout, and the poll loop will see it); after an abort it is
# fatal (see the header).
start_rolling_release() {
  local id="$1"
  api POST "/v1/projects/${VERCEL_PROJECT_ID}/rolling-release/start" "{\"canaryDeploymentId\":\"${id}\"}"
  case "$API_STATUS" in
    200|201) echo "Started rolling release with canary ${id}"; return 0 ;;
    *)
      echo "::warning::rolling-release/start returned HTTP ${API_STATUS}: $(printf '%s' "$API_BODY" | head -c 300)"
      return 1
      ;;
  esac
}

abort_rolling_release() {
  local base_id="$1"
  # Instant Rollback to the base the stale canary was ramping from — the
  # documented way to stop an active rollout. No verified build is lost (the
  # deployment about to be started is a superset of the one aborted), but the
  # project is now in the rolled-back state described in the header: the
  # `start` that must follow is what gets it out again.
  api POST "/v1/projects/${VERCEL_PROJECT_ID}/rollback/${base_id}" '{}'
  case "$API_STATUS" in
    200|201) echo "Aborted the stale rolling release (Instant Rollback to base ${base_id}; the project is in rolled-back state until a rolling release completes)" ;;
    *)
      echo "::error::Could not abort the stale rolling release (HTTP ${API_STATUS}): $(printf '%s' "$API_BODY" | head -c 300)" >&2
      return 1
      ;;
  esac
}

cmd_ensure_canary() {
  local url="$1" ours ours_id ours_created attempt
  local state cur_id can_id queued can_created target
  local started=false aborted=false
  [ -n "$url" ] || { echo "::error::ensure-canary needs the deployment url" >&2; exit 2; }
  # Written BEFORE anything else so cd.yml can always read it: until this run
  # has seen the rollout state, the build may already be live via auto-assign.
  emit_output disposition unknown
  ours=$(deployment_identity "$url") || exit 1
  ours_id="${ours%% *}"
  ours_created="${ours#* }"
  echo "This deployment: ${ours_id} (${url})"

  attempt=0
  while [ "$attempt" -lt "$poll_attempts" ]; do
    attempt=$((attempt + 1))
    read_rolling_release

    case "$RR_KIND" in
      error) rr_error_exit ;;
      none)
        # No rolling release: production is whatever the target says.
        target=$(production_target_url) || exit 1
        target="${target#https://}"
        if [ "$target" = "${url#https://}" ]; then
          echo "No rolling release in progress; this deployment is the production target"
          emit_output canary_state current
          return 0
        fi
        if [ "$started" != true ]; then
          start_rolling_release "$ours_id" && emit_output disposition started
          started=true
        fi
        echo "  attempt ${attempt}/${poll_attempts}: production target is ${target:-<none>}, waiting"
        sleep "$poll_interval"
        continue
        ;;
    esac

    state=$(jqr "$RR_DOC" '.state')
    cur_id=$(jqr "$RR_DOC" '.currentDeployment.id')
    can_id=$(jqr "$RR_DOC" '.canaryDeployment.id')
    queued=$(jqr "$RR_DOC" '.queuedDeploymentId')

    if [ "$cur_id" = "$ours_id" ]; then
      echo "This deployment is the current production deployment (state=${state})"
      emit_output canary_state current
      return 0
    fi
    if [ "$RR_KIND" = "active" ] && [ "$can_id" = "$ours_id" ]; then
      echo "This deployment is the active canary ($(jqr "$RR_DOC" '.currentCanaryPercentage')%)"
      emit_output canary_state canary
      return 0
    fi

    # A rollout of ANOTHER deployment is active (ours may be queued behind it —
    # the queue only drains when that rollout resolves, which can be 40
    # minutes away). Decide by age, once.
    if [ "$RR_KIND" = "active" ] && [ -n "$can_id" ]; then
      can_created=$(jqr "$RR_DOC" '.canaryDeployment.createdAt')
      # A foreign canary is ACTIVE, so this build is at most queued — provably
      # not serving. Every refusal below leaves production untouched.
      if [ "$aborted" != true ]; then emit_output disposition untouched; fi
      if ! is_epoch "$can_created"; then
        echo "::error::Rolling release is ACTIVE with canary ${can_id} but its createdAt is missing or not numeric (${can_created:-<empty>}) — cannot tell whether it is older or newer than this deployment, refusing to abort it" >&2
        exit 1
      fi
      if [ "$can_created" -gt "$ours_created" ]; then
        echo "::error::Superseded: a newer deployment (${can_id}) is already the canary. This run's deployment (${ours_id}) will not be rolled out — a later deployment owns production now." >&2
        exit 1
      fi
      if [ "$aborted" = true ]; then
        # We already aborted once and started ours; a foreign ACTIVE canary
        # still showing is an eventually-consistent read, not a new rollout.
        # Never abort twice — the second rollback would abort OUR rollout.
        echo "  attempt ${attempt}/${poll_attempts}: API still shows canary ${can_id} after our start, waiting"
        sleep "$poll_interval"
        continue
      fi
      if [ -z "$cur_id" ]; then
        echo "::error::Rolling release is ACTIVE with canary ${can_id} but reports no currentDeployment — refusing to abort without a rollback target" >&2
        exit 1
      fi
      [ "$queued" = "$ours_id" ] && echo "This deployment is queued behind the older canary ${can_id}; resolving the stale rollout instead of waiting for it"
      echo "A stale rolling release is active (canary ${can_id}, older than this deployment) — aborting it so this deployment can roll out"
      emit_output disposition mutated
      abort_rolling_release "$cur_id" || exit 1
      aborted=true
      if ! start_rolling_release "$ours_id"; then
        echo "::error::The stale rolling release was aborted but rolling-release/start for ${ours_id} was refused. Production is serving the BASE (${cur_id}) with auto-assignment of production domains OFF, and this deployment was NOT started — nothing will change that by itself. Start it by hand (vercel rolling-release start --dpl=${ours_id}) or undo the rollback (vercel promote <deployment-url>)." >&2
        exit 1
      fi
      started=true
      sleep "$poll_interval"
      continue
    fi

    # Idle document (COMPLETE/ABORTED/...) and ours is not current: start ours.
    if [ "$started" != true ]; then
      start_rolling_release "$ours_id" && emit_output disposition started
      started=true
    fi
    echo "  attempt ${attempt}/${poll_attempts}: state=${state:-<none>} current=${cur_id:-<none>} canary=${can_id:-<none>}, waiting"
    sleep "$poll_interval"
  done

  echo "::error::Deployment ${ours_id} never became the canary or the current production deployment after ${poll_attempts} attempts — production is NOT serving this commit. Inspect the rolling release before trusting this run." >&2
  exit 1
}

# ---------- superseded ---------------------------------------------------

# Who owns production right now? Sets OWNER_ID / OWNER_CREATED; non-zero when
# that cannot be established. The active canary when a rollout is ACTIVE (that
# is where traffic is heading); otherwise the project's production target —
# the same source `lkg` uses, because an idle rolling-release document is a
# record of the LAST rollout, not of what serves now (a hand promote since
# then would not be in it).
OWNER_ID=""
OWNER_CREATED=""
production_owner() {
  OWNER_ID=""
  OWNER_CREATED=""
  read_rolling_release
  case "$RR_KIND" in
    error) return 1 ;;
    active)
      OWNER_ID=$(jqr "$RR_DOC" '.canaryDeployment.id')
      OWNER_CREATED=$(jqr "$RR_DOC" '.canaryDeployment.createdAt')
      ;;
    idle|none)
      api GET "/v9/projects/${VERCEL_PROJECT_ID}"
      [ "$API_STATUS" = "200" ] || return 1
      OWNER_ID=$(jqr "$API_BODY" '.targets.production.id')
      OWNER_CREATED=$(jqr "$API_BODY" '.targets.production.createdAt')
      ;;
  esac
  [ -n "$OWNER_ID" ]
}

cmd_superseded() {
  local url="$1" ours ours_id ours_created
  [ -n "$url" ] || { echo "::error::superseded needs the deployment url" >&2; exit 2; }
  # Every "cannot tell" below answers false: a probe failure whose cause cannot
  # be established is still rolled back.
  if ! ours=$(deployment_identity "$url"); then
    echo "::warning::Could not resolve this deployment; answering superseded=false so the rollback proceeds"
    emit_output superseded false
    return 0
  fi
  ours_id="${ours%% *}"
  ours_created="${ours#* }"
  if ! production_owner; then
    echo "::warning::Could not determine who owns production (rolling release ${RR_KIND:-?}, HTTP ${RR_STATUS:-?}); answering superseded=false so the rollback proceeds"
    emit_output superseded false
    return 0
  fi
  emit_output owner "$OWNER_ID"
  echo "Production owner: ${OWNER_ID} (createdAt ${OWNER_CREATED:-?}); this deployment: ${ours_id} (createdAt ${ours_created})"
  if [ "$OWNER_ID" = "$ours_id" ]; then
    echo "This deployment owns production — the failed probe is about THIS build"
    emit_output superseded false
    return 0
  fi
  if is_epoch "$OWNER_CREATED" && [ "$OWNER_CREATED" -gt "$ours_created" ]; then
    echo "::notice::Superseded: a NEWER deployment (${OWNER_ID}) owns production. This run's probe failed because a later deployment overtook it, not because the build is unhealthy — no rollback."
    emit_output superseded true
    return 0
  fi
  echo "An OLDER (or undatable) deployment owns production — this build never took over; rolling back is the right answer"
  emit_output superseded false
}

# ---------- dispatch -------------------------------------------------------

case "$cmd" in
  lkg) cmd_lkg ;;
  ensure-canary) cmd_ensure_canary "$arg" ;;
  superseded) cmd_superseded "$arg" ;;
  *)
    echo "usage: $0 lkg | ensure-canary <deployment-url> | superseded <deployment-url>" >&2
    exit 2
    ;;
esac
