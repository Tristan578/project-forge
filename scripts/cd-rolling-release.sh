#!/usr/bin/env bash
# cd-rolling-release.sh
#
# The two Rolling Release questions cd.yml's production deploy has to answer
# truthfully, and could not (#9624, #9625):
#
#   lkg                              Which deployment is serving production
#                                    RIGHT NOW? (the rollback target)
#   ensure-canary <deployment-url>   Is the deployment we just made the one a
#                                    verification step will actually observe?
#
# WHY `vercel ls | grep READY` COULD NOT ANSWER THE FIRST
#
# The CLI prints `● Ready`, so the grep matched nothing and every run logged
# `Last-known-good production URL: unknown`; both rollback steps are guarded
# on that output being non-empty, so automatic rollback has never fired. And
# under Rolling Releases the newest READY production deployment is the CANARY,
# not the base — the live base is `rolling-release.currentDeployment`.
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
# finds ramping. That older canary is therefore aborted (instant rollback to
# the base it was ramping from — nothing is lost) and this deployment is
# started in its place. The reverse case — an older run finding a NEWER canary
# — is a superseded run and fails loudly; it must not touch the rollout.
#
# Environment:
#   VERCEL_TOKEN VERCEL_TEAM_ID VERCEL_PROJECT_ID   required
#   VERCEL_API_URL        test seam (default https://api.vercel.com)
#   RR_POLL_ATTEMPTS      ensure-canary polling budget (default 20)
#   RR_POLL_INTERVAL_S    seconds between polls (default 6)
#   GITHUB_OUTPUT         when set, `lkg` appends prev_url=<url> and
#                         `ensure-canary` appends canary_state=<current|canary>
#
# Exit codes: 0 answered; 1 could not answer / superseded; 2 tooling error.
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
# doing `body=$(api ...)` would run it in a subshell and lose the status —
# which is exactly how the first cut of this script reported "HTTP " (empty)
# on every call.
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

# Sets RR_STATUS and RR_BODY (the rolling-release JSON, possibly empty).
RR_STATUS=""
RR_BODY=""
read_rolling_release() {
  api GET "/v1/projects/${VERCEL_PROJECT_ID}/rolling-release"
  RR_STATUS="$API_STATUS"
  RR_BODY="$API_BODY"
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
  local rr url state
  read_rolling_release
  rr="$RR_BODY"
  if [ "$RR_STATUS" = "200" ]; then
    state=$(jqr "$rr" '.state')
    if [ "$state" = "ACTIVE" ]; then
      url=$(jqr "$rr" '.currentDeployment.url')
      if [ -z "$url" ]; then
        echo "::error::Rolling release is ACTIVE but reports no currentDeployment — refusing to guess a rollback target" >&2
        exit 1
      fi
      url=$(with_scheme "$url")
      echo "Last-known-good production URL: ${url} (rolling release ACTIVE — the base, not the canary)"
      emit_output prev_url "$url"
      printf '%s\n' "$url"
      return 0
    fi
  elif [ "$RR_STATUS" != "404" ] && [ "$RR_STATUS" != "400" ]; then
    # 404/400 = Rolling Releases not enabled on this project; anything else
    # is a real failure and must not degrade into "no rollback target".
    echo "::error::Rolling release lookup failed (HTTP ${RR_STATUS})" >&2
    exit 1
  fi

  url=$(production_target_url) || exit 1
  if [ -z "$url" ]; then
    echo "::error::Project reports no production target deployment — refusing to emit an empty rollback target" >&2
    exit 1
  fi
  url=$(with_scheme "$url")
  echo "Last-known-good production URL: ${url} (production target)"
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
  if [ -z "$id" ] || [ -z "$created" ]; then
    echo "::error::Deployment lookup for ${host} returned no id/createdAt" >&2
    return 1
  fi
  printf '%s %s\n' "$id" "$created"
}

start_rolling_release() {
  local id="$1"
  api POST "/v1/projects/${VERCEL_PROJECT_ID}/rolling-release/start" "{\"canaryDeploymentId\":\"${id}\"}"
  case "$API_STATUS" in
    200|201) echo "Started rolling release with canary ${id}" ;;
    *) echo "::warning::rolling-release/start returned HTTP ${API_STATUS}: $(printf '%s' "$API_BODY" | head -c 300)" ;;
  esac
}

abort_rolling_release() {
  local base_id="$1"
  # Instant rollback to the base the stale canary was ramping from. This is the
  # documented way to stop an active rollout; it loses nothing, because the
  # deployment about to be started is a superset of the one being aborted.
  api POST "/v1/projects/${VERCEL_PROJECT_ID}/rollback/${base_id}" '{}'
  case "$API_STATUS" in
    200|201) echo "Aborted the stale rolling release (rolled back to base ${base_id})" ;;
    *)
      echo "::error::Could not abort the stale rolling release (HTTP ${API_STATUS}): $(printf '%s' "$API_BODY" | head -c 300)" >&2
      return 1
      ;;
  esac
}

cmd_ensure_canary() {
  local url="$1" ours ours_id ours_created rr state cur_id can_id queued can_created attempt started=false
  [ -n "$url" ] || { echo "::error::ensure-canary needs the deployment url" >&2; exit 2; }
  ours=$(deployment_identity "$url") || exit 1
  ours_id="${ours%% *}"
  ours_created="${ours#* }"
  echo "This deployment: ${ours_id} (${url})"

  attempt=0
  while [ "$attempt" -lt "$poll_attempts" ]; do
    attempt=$((attempt + 1))
    read_rolling_release
    rr="$RR_BODY"

    if [ "$RR_STATUS" = "404" ] || [ "$RR_STATUS" = "400" ]; then
      # Rolling Releases not enabled: production is whatever the target says.
      local target
      target=$(production_target_url) || exit 1
      target="${target#https://}"
      if [ "$target" = "${url#https://}" ]; then
        echo "Rolling Releases are not enabled; this deployment is the production target"
        emit_output canary_state current
        return 0
      fi
      echo "  attempt ${attempt}/${poll_attempts}: production target is ${target:-<none>}, waiting"
      sleep "$poll_interval"
      continue
    fi
    if [ "$RR_STATUS" != "200" ]; then
      echo "::error::Rolling release lookup failed (HTTP ${RR_STATUS})" >&2
      exit 1
    fi

    state=$(jqr "$rr" '.state')
    cur_id=$(jqr "$rr" '.currentDeployment.id')
    can_id=$(jqr "$rr" '.canaryDeployment.id')
    queued=$(jqr "$rr" '.queuedDeploymentId')

    if [ "$cur_id" = "$ours_id" ]; then
      echo "This deployment is the current production deployment"
      emit_output canary_state current
      return 0
    fi
    if [ "$can_id" = "$ours_id" ]; then
      echo "This deployment is the active canary (state=${state}, $(jqr "$rr" '.currentCanaryPercentage')%)"
      emit_output canary_state canary
      return 0
    fi
    if [ "$queued" = "$ours_id" ]; then
      echo "  attempt ${attempt}/${poll_attempts}: queued behind canary ${can_id:-<none>}, waiting"
      sleep "$poll_interval"
      continue
    fi

    if [ "$state" = "ACTIVE" ] && [ -n "$can_id" ]; then
      can_created=$(jqr "$rr" '.canaryDeployment.createdAt')
      if [ -n "$can_created" ] && [ "$can_created" -gt "$ours_created" ] 2>/dev/null; then
        echo "::error::Superseded: a newer deployment (${can_id}) is already the canary. This run's deployment (${ours_id}) will not be rolled out — a later merge owns production now." >&2
        exit 1
      fi
      echo "A stale rolling release is active (canary ${can_id}, older than this deployment) — aborting it so this deployment can roll out"
      abort_rolling_release "$cur_id" || exit 1
      started=false
    fi

    if [ "$started" != true ]; then
      start_rolling_release "$ours_id"
      started=true
    fi
    echo "  attempt ${attempt}/${poll_attempts}: state=${state:-<none>} current=${cur_id:-<none>} canary=${can_id:-<none>}, waiting"
    sleep "$poll_interval"
  done

  echo "::error::Deployment ${ours_id} never became the canary or the current production deployment after ${poll_attempts} attempts — production is NOT serving this commit. Inspect the rolling release before trusting this run." >&2
  exit 1
}

# ---------- dispatch -------------------------------------------------------

case "$cmd" in
  lkg) cmd_lkg ;;
  ensure-canary) cmd_ensure_canary "$arg" ;;
  *)
    echo "usage: $0 lkg | ensure-canary <deployment-url>" >&2
    exit 2
    ;;
esac
