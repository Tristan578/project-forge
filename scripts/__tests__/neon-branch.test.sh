#!/usr/bin/env bash
# Unit tests for scripts/neon-branch.sh — the Neon snapshot/dry-run branch helper
# the production deploy uses (#9456) — plus the seam anti-tamper assertions this
# repo requires of any script carrying a test-only command override.
#
# WHY THIS HELPER EXISTS
# ----------------------
# cd.yml mutates the production database before the new code deploys. #9456
# requires (a) a snapshot taken immediately before that mutation, whose id is
# echoed to the job log, and (b) the migration to be rehearsed somewhere that is
# not production. A Neon branch is both: it is a copy-on-write clone of the
# parent branch at the instant it is created, so `create` with no compute is the
# snapshot and `create --endpoint` is the rehearsal target.
#
# HERMETIC TESTING — AND WHY IT MUST STAY THAT WAY
# ------------------------------------------------
# These tests MUST NOT reach console.neon.tech. The helper therefore reads its
# HTTP client from $NEON_CURL_CMD (default `curl`), and this suite injects a stub
# that replays canned responses and records the requests. The stub is the ONLY
# thing that makes the failure branches — 401, a body with no branch.id, a
# partial prune — testable at all; a live-API test could not produce them on
# demand and would be non-deterministic besides.
#
# $NEON_CURL_CMD is a TEST-ONLY seam. Wired into CI it would let a workflow
# replace the real API calls with `true`, and the deploy would report a snapshot
# it never took — strictly worse than today, because the rollback path would then
# name a branch id that does not exist. Two guards below make that unbypassable:
# a static scan of every workflow and composite action, and an unconditional
# runtime assertion (NOT scoped to $CI, which is itself settable from a workflow
# env block) that fires if the override is set at all. There is no self-re-exec
# in this suite — it never sets the seam in its OWN environment, only on the
# child `bash "$SCRIPT"` invocations — so there is no `--selftest-child` literal
# to consume; the scan still covers BASH_ENV, which would let a workflow execute
# arbitrary code before this script's body runs.
set -uo pipefail

# SIGPIPE-safe matching: feed grep/awk from a here-string, and never pipe a
# variable's echo output into grep/awk. Under `pipefail`, `grep -q` closes the
# pipe on its FIRST match; on a payload larger than the pipe buffer the
# still-writing writer takes SIGPIPE, which `pipefail` turns into a non-zero
# pipeline status — silently converting a real match into a false "missing".

command -v jq >/dev/null 2>&1 || { echo "jq is required for these tests"; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../neon-branch.sh"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
FAILURES=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ -f "$SCRIPT" ] || { echo "helper not found: $SCRIPT"; exit 1; }

# --------------------------------------------------------------------------
# RUNTIME ANTI-TAMPER — unconditional, evaluated on every invocation.
# Deliberately NOT gated on $CI: a bare `CI=` in a workflow env block would
# neuter a CI-scoped version of this check. If $NEON_CURL_CMD is set in this
# suite's own environment, something outside the suite wired the seam, and the
# hermetic-stub guarantee no longer holds.
# --------------------------------------------------------------------------
if [ -n "${NEON_CURL_CMD:-}" ]; then
  echo "  FAIL: runtime: NEON_CURL_CMD must never be set outside this suite's own child invocations (out-of-tree tampering detected)"
  echo "1 test(s) failed."
  exit 1
fi

TMPDIR_T="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T"' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

STUB="$TMPDIR_T/curl-stub.sh"
cat > "$STUB" <<'STUBEOF'
#!/usr/bin/env bash
# Stand-in for `curl` in the shape neon-branch.sh calls it:
#   curl -sS -X <METHOD> <URL> -H ... -o <BODYFILE> -w '%{http_code}' [--data <JSON>]
# Replays $STUB_DIR/body.<n> + $STUB_DIR/status.<n> for the n-th call (falling
# back to body.default / status.default) and appends "<METHOD> <URL> <DATA>" to
# $STUB_LOG. Headers are never logged: one of them carries the API key.
set -uo pipefail
method=""; url=""; out=""; data=""
while [ $# -gt 0 ]; do
  case "$1" in
    -X) method="${2:-}"; shift 2 ;;
    -o) out="${2:-}"; shift 2 ;;
    -w) shift 2 ;;
    -H) shift 2 ;;
    --data) data="${2:-}"; shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
printf '%s %s %s\n' "$method" "$url" "$data" >> "$STUB_LOG"
n="$(wc -l < "$STUB_LOG" | tr -d ' ')"
body="$STUB_DIR/body.$n"; [ -f "$body" ] || body="$STUB_DIR/body.default"
stat="$STUB_DIR/status.$n"; [ -f "$stat" ] || stat="$STUB_DIR/status.default"
[ -n "$out" ] && [ -f "$body" ] && cat "$body" > "$out"
cat "$stat"
STUBEOF
chmod +x "$STUB"

# Reset the stub's canned responses. Callers then write body.N / status.N.
stub_reset() {
  rm -rf "$TMPDIR_T/stub"
  mkdir -p "$TMPDIR_T/stub"
  : > "$TMPDIR_T/stub.log"
  printf '{}' > "$TMPDIR_T/stub/body.default"
  printf '200' > "$TMPDIR_T/stub/status.default"
}
stub_body()   { cat > "$TMPDIR_T/stub/body.$1"; }
stub_status() { printf '%s' "$2" > "$TMPDIR_T/stub/status.$1"; }

# Run the helper against the stub; echo "<exit>|<output>".
# NEON_CURL_CMD is set ONLY on this child process — never exported into the
# suite's own environment (see the runtime anti-tamper above).
run_helper() {
  local out rc
  out="$(NEON_CURL_CMD="$STUB" \
         STUB_DIR="$TMPDIR_T/stub" STUB_LOG="$TMPDIR_T/stub.log" \
         NEON_API_KEY='test-key-not-real' NEON_PROJECT_ID='proj-test' \
         bash "$SCRIPT" "$@" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}

requests() { cat "$TMPDIR_T/stub.log"; }

echo "=== neon-branch.sh: create (the pre-migration snapshot) ==="

# --- 1. Snapshot branch: no compute endpoint ---------------------------------
# The snapshot is retained after the deploy, so it must NOT carry a compute
# endpoint — an idle compute is a standing cost and a standing attack surface,
# and a branch with no endpoint is still fully restorable.
stub_reset
stub_status 1 201
stub_body 1 <<'EOF'
{"branch":{"id":"br-snapshot-4821","name":"predeploy-abc123","created_at":"2026-08-29T10:00:00Z"}}
EOF
res="$(run_helper create predeploy-abc123)"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "create succeeds on 201 (exit 0)"; else fail "create should exit 0, got $rc ($out)"; fi
if grep -qxF 'branch_id=br-snapshot-4821' <<<"$out"; then
  pass "create echoes branch_id (AC: the snapshot id reaches the job log)"
else
  fail "create does not echo branch_id — the rollback path has nothing to name"
fi
if grep -qxF 'branch_name=predeploy-abc123' <<<"$out"; then pass "create echoes branch_name"; else fail "create does not echo branch_name"; fi
reqs="$(requests)"
if grep -qF 'POST https://console.neon.tech/api/v2/projects/proj-test/branches' <<<"$reqs"; then
  pass "create POSTs to /projects/{id}/branches"
else
  fail "create did not POST to the branches endpoint; log: $reqs"
fi
# The absent-endpoints property is the point of this case, so assert on the
# request BODY, not just the exit code.
if grep -qF 'endpoints' <<<"$reqs"; then
  fail "snapshot create requested a compute endpoint — it must be endpoint-less"
else
  pass "snapshot create requests no compute endpoint (no standing cost/surface)"
fi

# --- 2. Dry-run branch: with a read_write endpoint + connection URI ----------
stub_reset
stub_status 1 201
stub_body 1 <<'EOF'
{"branch":{"id":"br-dryrun-77","name":"dryrun-abc123"},
 "connection_uris":[{"connection_uri":"postgresql://u:SUPERSECRET@ep-dry.us-east-2.aws.neon.tech/neondb"}]}
EOF
uri_out="$TMPDIR_T/dryrun.uri"
res="$(run_helper create dryrun-abc123 --endpoint --uri-out "$uri_out")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "create --endpoint succeeds (exit 0)"; else fail "create --endpoint should exit 0, got $rc ($out)"; fi
if grep -qF '"type": "read_write"' <<<"$(requests)" || grep -qF '"type":"read_write"' <<<"$(requests)"; then
  pass "create --endpoint requests a read_write compute (the dry run has to write)"
else
  fail "create --endpoint did not request a read_write endpoint; log: $(requests)"
fi
# SECRET HANDLING: the connection URI is a live credential. It must land in the
# file and NEVER on stdout — a job log is retained and readable by anyone with
# repo read access, and cd.yml can only ::add-mask:: what it has already read.
if grep -qF 'SUPERSECRET' <<<"$out"; then
  fail "the branch connection URI was printed to stdout — it would land in the job log verbatim"
else
  pass "the branch connection URI is never printed to stdout"
fi
if [ -f "$uri_out" ] && grep -qF 'SUPERSECRET' "$uri_out"; then
  pass "the connection URI is written to the --uri-out file"
else
  fail "the connection URI was not written to $uri_out"
fi
# shellcheck disable=SC2012
# `ls -l` is the portable way to read the mode here; the path is a fixed
# mktemp-derived name we created ourselves, so the filename caveat cannot apply.
mode="$(ls -l "$uri_out" | cut -c1-10)"
if [ "$mode" = "-rw-------" ]; then
  pass "the --uri-out file is mode 600 (owner-only)"
else
  fail "the --uri-out file is $mode, expected -rw------- (a world-readable credential on a shared runner)"
fi

# --- 3. --endpoint response with no connection URI → fail loudly -------------
# Silently continuing would leave the dry-run step with an empty DATABASE_URL,
# which drizzle-kit reports as a connection error and pgPush swallows into a
# zero exit — a rehearsal that never happened, reported as a success.
stub_reset
stub_status 1 201
stub_body 1 <<'EOF'
{"branch":{"id":"br-nouri-9"}}
EOF
res="$(run_helper create dryrun-x --endpoint --uri-out "$TMPDIR_T/nouri.uri")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "3" ]; then pass "missing connection_uri fails (exit 3)"; else fail "missing connection_uri should exit 3, got $rc"; fi
if grep -qF 'connection_uri' <<<"$out"; then pass "the missing-URI error names what was missing"; else fail "the missing-URI error is not specific"; fi

# --- 4. Response with no branch.id → refuse to continue ----------------------
# This is the fail-closed case that matters most: no id means no snapshot, and
# the deploy must not proceed to mutate production without one.
stub_reset
stub_status 1 200
stub_body 1 <<'EOF'
{"operations":[]}
EOF
res="$(run_helper create predeploy-y)"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "3" ]; then pass "a response with no branch.id fails (exit 3)"; else fail "no branch.id should exit 3, got $rc"; fi
if grep -qF 'without a snapshot' <<<"$out"; then
  pass "the no-id error says plainly it is refusing to continue without a snapshot"
else
  fail "the no-id error does not explain the refusal"
fi

# --- 5. Non-2xx → exit 3, and the response body is NOT dumped wholesale ------
# Neon error bodies can echo request content. The helper prints a bounded
# excerpt with connection URIs redacted; this pins both properties.
stub_reset
stub_status 1 401
long_secret="$(printf 'x%.0s' $(seq 1 400))"
{
  printf '{"message":"unauthorized","echo":"postgresql://u:LEAKED@ep-x.neon.tech/db","pad":"'
  printf '%s' "$long_secret"
  printf '"}'
} > "$TMPDIR_T/stub/body.1"
res="$(run_helper create predeploy-z)"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "3" ]; then pass "non-2xx status fails (exit 3)"; else fail "401 should exit 3, got $rc"; fi
if grep -qF "401" <<<"$out"; then pass "the API error names the HTTP status"; else fail "the API error does not name the status"; fi
if grep -qF 'LEAKED' <<<"$out"; then
  fail "a connection URI inside the error body was printed verbatim into the job log"
else
  pass "connection URIs in an error body are redacted before printing"
fi
if grep -qF "$long_secret" <<<"$out"; then
  fail "the whole error body was dumped — the excerpt is not bounded"
else
  pass "the error body is truncated to a bounded excerpt"
fi

echo ""
echo "=== neon-branch.sh: missing credentials fail CLOSED ==="
# The most important negative case in the file. If the credentials are absent
# the deploy must STOP, not proceed unsnapshotted. A helper that shrugged and
# exited 0 here would silently remove the entire safety net this ticket adds.
for missing in NEON_API_KEY NEON_PROJECT_ID; do
  out="$(NEON_CURL_CMD="$STUB" STUB_DIR="$TMPDIR_T/stub" STUB_LOG="$TMPDIR_T/stub.log" \
         NEON_API_KEY='test-key-not-real' NEON_PROJECT_ID='proj-test' \
         env -u "$missing" bash "$SCRIPT" create predeploy-q 2>&1)"; rc=$?
  if [ "$rc" = "2" ]; then
    pass "missing $missing exits 2 (deploy stops)"
  else
    fail "missing $missing should exit 2, got $rc"
  fi
  if grep -qF 'not permitted without a pre-migration snapshot' <<<"$out"; then
    pass "missing $missing explains that the migration is not permitted"
  else
    fail "missing $missing does not explain the consequence"
  fi
done

echo ""
echo "=== neon-branch.sh: delete ==="
stub_reset
stub_status 1 200
res="$(run_helper delete br-dryrun-77)"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "delete succeeds (exit 0)"; else fail "delete should exit 0, got $rc"; fi
if grep -qF 'DELETE https://console.neon.tech/api/v2/projects/proj-test/branches/br-dryrun-77' <<<"$(requests)"; then
  pass "delete targets /projects/{id}/branches/{branch_id}"
else
  fail "delete hit the wrong endpoint; log: $(requests)"
fi
if grep -qxF 'deleted=br-dryrun-77' <<<"$out"; then pass "delete echoes the deleted id"; else fail "delete does not echo the deleted id"; fi

stub_reset
stub_status 1 404
res="$(run_helper delete br-gone)"
rc="${res%%|*}"
if [ "$rc" = "3" ]; then pass "delete of a missing branch fails (exit 3)"; else fail "delete 404 should exit 3, got $rc"; fi

echo ""
echo "=== neon-branch.sh: prune (snapshot retention) ==="
# Snapshots are RETAINED after a successful deploy — that is the whole point, a
# snapshot deleted at the end of the job protects nothing. Prune is the
# housekeeping that stops them accumulating forever, and it must be exact:
# too eager and it deletes the snapshot an operator is about to restore from.
stub_reset
stub_status 1 200
stub_body 1 <<'EOF'
{"branches":[
  {"id":"br-old-1","name":"predeploy-aaa","created_at":"2020-01-01T00:00:00Z"},
  {"id":"br-old-2","name":"predeploy-bbb","created_at":"2020-02-01T00:00:00Z"},
  {"id":"br-fresh","name":"predeploy-ccc","created_at":"2099-01-01T00:00:00Z"},
  {"id":"br-main","name":"main","created_at":"2020-01-01T00:00:00Z"},
  {"id":"br-other","name":"feature-x","created_at":"2020-01-01T00:00:00Z"}
]}
EOF
stub_status 2 200
stub_status 3 200
res="$(run_helper prune predeploy- 7)"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "prune succeeds (exit 0)"; else fail "prune should exit 0, got $rc ($out)"; fi
if grep -qxF 'pruned=2' <<<"$out"; then pass "prune deletes exactly the two stale prefixed branches"; else fail "prune should report pruned=2; got: $(grep -F 'pruned=' <<<"$out" | tr '\n' ' ')"; fi
reqs="$(requests)"
if grep -qF 'branches/br-main' <<<"$reqs"; then
  fail "prune deleted the project's main branch — the name-prefix filter is broken"
else
  pass "prune never touches a branch outside the name prefix (main survived)"
fi
if grep -qF 'branches/br-fresh' <<<"$reqs"; then
  fail "prune deleted a snapshot inside the retention window — an operator could still need it"
else
  pass "prune respects the retention window (the fresh snapshot survived)"
fi
if grep -qF 'branches/br-other' <<<"$reqs"; then fail "prune deleted an unrelated branch"; else pass "prune leaves unrelated branches alone"; fi

# No stale matches → no DELETE at all.
stub_reset
stub_status 1 200
stub_body 1 <<'EOF'
{"branches":[{"id":"br-fresh","name":"predeploy-ccc","created_at":"2099-01-01T00:00:00Z"}]}
EOF
res="$(run_helper prune predeploy- 7)"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ] && grep -qxF 'pruned=0' <<<"$out"; then pass "prune with no stale matches reports pruned=0"; else fail "prune with no matches should report pruned=0 (rc=$rc)"; fi
if grep -qF 'DELETE' <<<"$(requests)"; then fail "prune issued a DELETE with nothing stale to delete"; else pass "prune issues no DELETE when nothing is stale"; fi

# A failed individual delete must WARN, never fail the job: prune runs after a
# deploy that already succeeded, and failing it would turn a green production
# release red over housekeeping.
stub_reset
stub_status 1 200
stub_body 1 <<'EOF'
{"branches":[{"id":"br-old-1","name":"predeploy-aaa","created_at":"2020-01-01T00:00:00Z"}]}
EOF
stub_status 2 500
res="$(run_helper prune predeploy- 7)"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "a failed prune delete does not fail the job (exit 0)"; else fail "prune should stay exit 0 when a delete fails, got $rc"; fi
if grep -qF '::warning::' <<<"$out"; then pass "a failed prune delete emits a ::warning::"; else fail "a failed prune delete is silent"; fi

echo ""
echo "=== neon-branch.sh: usage contract ==="
assert_usage() {
  local label="$1"; shift
  local res rc
  res="$(run_helper "$@")"
  rc="${res%%|*}"
  if [ "$rc" = "64" ]; then pass "$label is a usage error (exit 64)"; else fail "$label should exit 64, got $rc"; fi
}
assert_usage "no subcommand" ""
assert_usage "unknown subcommand" bogus
assert_usage "create with no name" create
assert_usage "create with two names" create a b
assert_usage "create with an unknown flag" create a --wat
assert_usage "delete with no id" delete
assert_usage "prune with no prefix" prune
assert_usage "prune with a non-numeric retention" prune predeploy- seven
assert_usage "prune with a negative retention" prune predeploy- -3
# --uri-out without --endpoint is a usage error, not a silent no-op: a branch
# with no compute has no connection URI, so the caller's expectation is wrong
# and the dry-run step downstream would read an empty file.
assert_usage "--uri-out without --endpoint" create a --uri-out "$TMPDIR_T/x.uri"
assert_usage "--uri-out with no path" create a --endpoint --uri-out

echo ""
echo "=== the helper never prints a credential (structural) ==="
# Mutation-provable: change the --uri-out write to an `echo` and this fails.
helper_exec="$(grep -v '^[[:space:]]*#' "$SCRIPT" || true)"
if grep -qE '(echo|printf)[^>]*\$\{?uri\}?"?[[:space:]]*$' <<<"$helper_exec"; then
  fail "the helper echoes \$uri to stdout — the connection URI would land in the job log"
else
  pass "the helper never echoes \$uri to stdout"
fi
if grep -qF 'chmod 600' <<<"$helper_exec"; then
  pass "the helper chmods the credential file"
else
  fail "the helper does not chmod the credential file"
fi
# The API key is passed via -H. It must never be interpolated into a URL (which
# curl and any proxy would log) or echoed.
# The API key must never be interpolated into a URL (curl, and any proxy in
# between, log request lines) nor echoed. Naming the VARIABLE in a "must be set"
# message is fine — that prints the name, not the value — so the check looks for
# an EXPANSION of it on an echo/printf line or on a line carrying a URL.
# shellcheck disable=SC2016
# The single quotes are deliberate: we search the helper's SOURCE for the literal
# token $NEON_API_KEY, so it must not expand here.
key_leaks="$(grep -nE '\$\{?NEON_API_KEY\}?' <<<"$helper_exec" | grep -E '(echo|printf|https?://)' || true)"
if [ -n "$key_leaks" ]; then
  fail "NEON_API_KEY is expanded into an echo/printf or a URL:"
  printf '        %s\n' "$key_leaks"
else
  pass "NEON_API_KEY is never expanded into a URL or printed"
fi

echo ""
echo "=== \$NEON_CURL_CMD seam anti-tamper (static scan) ==="
# The seam must never be wired anywhere GitHub Actions executes. Scan workflows
# AND composite actions, comment-stripped (a doc mention is not a wiring), and
# fail CLOSED on a missing/unreadable directory or a grep scan error (exit >= 2)
# — a scan that cannot run is not a scan that passed. BASH_ENV is scanned
# alongside: it names a script bash sources before every non-interactive
# invocation, so wiring it would let a workflow set NEON_CURL_CMD (or anything
# else) before this suite's body runs.
scan_dir() {
  local dir="$1" label="$2" hits rc
  if [ ! -d "$dir" ]; then
    if [ "$label" = "workflows" ]; then
      fail "seam scan: $dir is missing — the scan cannot run, so it cannot pass"
    else
      pass "seam scan: $label dir absent (nothing to wire the seam into)"
    fi
    return
  fi
  # Strip full-comment lines first, then look for the seam literals.
  hits="$(grep -rh -v '^[[:space:]]*#' "$dir" 2>/dev/null | grep -nE 'NEON_CURL_CMD|BASH_ENV' 2>/dev/null)"
  rc=$?
  if [ "$rc" -ge 2 ]; then
    fail "seam scan: grep failed while scanning $dir (exit $rc) — failing closed"
    return
  fi
  if [ -n "$hits" ]; then
    fail "seam scan: NEON_CURL_CMD / BASH_ENV is wired in $label — the snapshot step can be no-op'd into a false pass"
    printf '        %s\n' "$hits"
  else
    pass "seam scan: NEON_CURL_CMD / BASH_ENV not wired in $label"
  fi
}
scan_dir "$REPO_ROOT/.github/workflows" workflows
scan_dir "$REPO_ROOT/.github/actions" "composite actions"

echo ""
echo "=== ci.yml self-defense wiring ==="
if [ -f "$CI_YML" ]; then
  ci="$(cat "$CI_YML")"
  if grep -qF 'bash scripts/__tests__/neon-branch.test.sh' <<<"$ci"; then
    pass "CI runs this suite"
  else
    fail "CI does not run scripts/__tests__/neon-branch.test.sh — regressions would ship green"
  fi
  if grep -qF 'scripts/neon-branch.sh' <<<"$ci"; then
    pass "CI shellchecks scripts/neon-branch.sh"
  else
    fail "CI does not shellcheck scripts/neon-branch.sh"
  fi
else
  fail "ci.yml not found at $CI_YML"
fi

echo ""
echo "=== suite hygiene (structural) ==="
SELF="${BASH_SOURCE[0]}"
if grep -nE 'echo[[:space:]]+"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?"[[:space:]]*\|[[:space:]]*(grep|awk)' "$SELF" >/dev/null; then
  fail "a variable's echo output is piped into grep/awk — feed it via a here-string to stay correct under pipefail"
else
  pass "suite feeds grep/awk via here-strings, not variable pipes (SIGPIPE-safe under pipefail)"
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
