#!/usr/bin/env bash
# Contract tests for scripts/deploy-drift-dispatch.sh (#9640).
#
# `gh` and `curl` are stubbed on PATH. The gh stub answers `gh api <path>` from
# a fixture keyed by the path (query string stripped) and records every call —
# including `gh workflow run` — so the suite can assert WHAT was dispatched and
# that a dispatch is never reported as done without a run appearing.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../deploy-drift-dispatch.sh"
[ -f "$SCRIPT" ] || { echo "script not found: $SCRIPT"; exit 1; }

PASS=0
FAIL=0
pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/fx" "$TMP/cnt"

cat > "$TMP/bin/gh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$LOG"
case "$1" in
  api)
    path="${2%%\?*}"
    # Query params matter for one key: the verification poll asks for
    # event=workflow_dispatch; answer it from <key>.dispatch when present.
    key="$(printf '%s' "$path" | tr '/' '_')"
    case "$2" in *event=workflow_dispatch*) [ -f "$FIXTURES/$key.dispatch" ] && key="$key.dispatch" ;; esac
    n=$(( $(cat "$COUNTS/$key" 2>/dev/null || echo 0) + 1 ))
    echo "$n" > "$COUNTS/$key"
    fx="$FIXTURES/$key.$n"
    [ -f "$fx" ] || fx="$FIXTURES/$key"
    if [ -f "$fx" ]; then cat "$fx"; exit 0; fi
    echo '{"message":"Not Found"}' >&2; exit 1 ;;
  workflow)
    # `gh workflow run <wf> --ref <branch> --repo <repo>`: fail when the
    # fixture says so, N times.
    wf="$3"
    n=$(( $(cat "$COUNTS/run_$wf" 2>/dev/null || echo 0) + 1 ))
    echo "$n" > "$COUNTS/run_$wf"
    limit="$(cat "$FIXTURES/fail_run_$wf" 2>/dev/null || echo 0)"
    if [ "$n" -le "$limit" ]; then echo "HTTP 422: refused" >&2; exit 1; fi
    exit 0 ;;
esac
exit 1
EOF
cat > "$TMP/bin/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >> "$LOG"
if [ -f "$FIXTURES/health" ]; then cat "$FIXTURES/health"; exit 0; fi
exit 7
EOF
chmod +x "$TMP/bin/gh" "$TMP/bin/curl"

REPO=o/r
HEAD=abcdef1234567890abcdef1234567890abcdef12
fixture() { printf '%s' "$2" > "$TMP/fx/$(printf '%s' "$1" | tr '/' '_')"; }
reset() { rm -f "$TMP/fx"/* "$TMP/cnt"/*; : > "$TMP/log"; : > "$TMP/out"; fixture "repos/$REPO/branches/main" "{\"commit\":{\"sha\":\"$HEAD\"}}"; }
runs() { printf '{"total_count":%s,"workflow_runs":[%s]}' "$1" "${2:-}"; }
run_script() {
  (PATH="$TMP/bin:$PATH" LOG="$TMP/log" FIXTURES="$TMP/fx" COUNTS="$TMP/cnt" \
    GH_TOKEN=t GITHUB_REPOSITORY="$REPO" DRIFT_SLEEP_S=0 DRIFT_VERIFY_ATTEMPTS=3 DRIFT_HEALTH_URL=https://h.test/api/health \
    GITHUB_OUTPUT="$TMP/out" bash "$SCRIPT" 2>&1)
}
count_dispatch() { grep -c "^workflow run $1 --ref main" "$TMP/log" || true; }

echo "=== nothing to do ==="
reset
fixture "repos/$REPO/actions/workflows/ci.yml/runs" "$(runs 2)"
fixture "repos/$REPO/actions/workflows/cd.yml/runs" "$(runs 1)"
OUT="$(run_script)"; RC=$?
if [ "$RC" = 0 ] && ! grep -q '^workflow run' "$TMP/log" && grep -q '^dispatched=none$' "$TMP/out" && grep -q "^head=$HEAD$" "$TMP/out"; then
  pass "runs exist for the head on both workflows: exits 0, dispatches nothing, reports dispatched=none"
else
  fail "nothing to do: rc=$RC log=$(cat "$TMP/log") out=$(cat "$TMP/out") $OUT"
fi

echo "=== a FAILED run still counts as a run ==="
reset
fixture "repos/$REPO/actions/workflows/ci.yml/runs" "$(runs 1 '{"id":1,"conclusion":"failure"}')"
fixture "repos/$REPO/actions/workflows/cd.yml/runs" "$(runs 1 '{"id":2,"conclusion":"failure"}')"
OUT="$(run_script)"; RC=$?
if [ "$RC" = 0 ] && ! grep -q '^workflow run' "$TMP/log"; then
  pass "a failed run is not re-dispatched every fifteen minutes (it already rolled back and opened its incident)"
else
  fail "failed run re-dispatched: rc=$RC log=$(cat "$TMP/log")"
fi

echo "=== the #9640 case: a merge with zero runs ==="
reset
fixture "repos/$REPO/actions/workflows/ci.yml/runs" "$(runs 0)"
fixture "repos/$REPO/actions/workflows/cd.yml/runs" "$(runs 0)"
fixture "repos/$REPO/actions/workflows/ci.yml/runs.dispatch" "$(runs 1 '{"id":101,"event":"workflow_dispatch"}')"
fixture "repos/$REPO/actions/workflows/cd.yml/runs.dispatch" "$(runs 1 '{"id":202,"event":"workflow_dispatch"}')"
fixture health '{"status":"ok","commit":"77bc90c6"}'
OUT="$(run_script)"; RC=$?
if [ "$RC" = 0 ] && [ "$(count_dispatch ci.yml)" = 1 ] && [ "$(count_dispatch cd.yml)" = 1 ] && grep -q '^dispatched=ci.yml cd.yml$' "$TMP/out"; then
  pass "no runs for the head and production on an older commit: dispatches ci.yml and cd.yml once each"
else
  fail "zero-run merge: rc=$RC log=$(cat "$TMP/log") out=$(cat "$TMP/out") $OUT"
fi
if grep -q 'run 202 exists' <<<"$OUT" && grep -q 'actions/runs/202' <<<"$OUT"; then
  pass "the log names the run it created"
else
  fail "the created run is not named: $OUT"
fi

echo "=== production already serves the head ==="
reset
fixture "repos/$REPO/actions/workflows/ci.yml/runs" "$(runs 3)"
fixture "repos/$REPO/actions/workflows/cd.yml/runs" "$(runs 0)"
fixture health "{\"status\":\"ok\",\"commit\":\"$(printf '%s' "$HEAD" | cut -c1-8)\"}"
OUT="$(run_script)"; RC=$?
if [ "$RC" = 0 ] && ! grep -q '^workflow run' "$TMP/log" && grep -q 'nothing to deploy' <<<"$OUT"; then
  pass "main and production already match: exits without dispatching cd.yml"
else
  fail "already deployed: rc=$RC log=$(cat "$TMP/log") $OUT"
fi

echo "=== an unreadable health endpoint does not suppress the deploy ==="
reset
fixture "repos/$REPO/actions/workflows/ci.yml/runs" "$(runs 1)"
fixture "repos/$REPO/actions/workflows/cd.yml/runs" "$(runs 0)"
fixture "repos/$REPO/actions/workflows/cd.yml/runs.dispatch" "$(runs 1 '{"id":303}')"
OUT="$(run_script)"; RC=$?
if [ "$RC" = 0 ] && [ "$(count_dispatch cd.yml)" = 1 ] && [ "$(count_dispatch ci.yml)" = 0 ]; then
  pass "health unreadable, no cd run: cd.yml is dispatched (ci.yml, which has a run, is not)"
else
  fail "health unreadable: rc=$RC log=$(cat "$TMP/log") $OUT"
fi

echo "=== dispatch is retried, then verified ==="
reset
fixture "repos/$REPO/actions/workflows/ci.yml/runs" "$(runs 1)"
fixture "repos/$REPO/actions/workflows/cd.yml/runs" "$(runs 0)"
fixture "repos/$REPO/actions/workflows/cd.yml/runs.dispatch" "$(runs 1 '{"id":404}')"
printf 2 > "$TMP/fx/fail_run_cd.yml"
OUT="$(run_script)"; RC=$?
if [ "$RC" = 0 ] && [ "$(count_dispatch cd.yml)" = 3 ]; then
  pass "two refused dispatches are retried; the third succeeds and is verified"
else
  fail "retry: rc=$RC dispatches=$(count_dispatch cd.yml) $OUT"
fi

echo "=== refusals ==="
reset
fixture "repos/$REPO/actions/workflows/ci.yml/runs" "$(runs 1)"
fixture "repos/$REPO/actions/workflows/cd.yml/runs" "$(runs 0)"
printf 99 > "$TMP/fx/fail_run_cd.yml"
OUT="$(run_script)"; RC=$?
if [ "$RC" != 0 ] && [ "$(count_dispatch cd.yml)" = 3 ] && grep -q '::error::Could not dispatch cd.yml' <<<"$OUT"; then
  pass "the dispatch API failing every attempt fails the job loudly (no silent miss)"
else
  fail "dispatch always failing: rc=$RC dispatches=$(count_dispatch cd.yml) $OUT"
fi

reset
fixture "repos/$REPO/actions/workflows/ci.yml/runs" "$(runs 1)"
fixture "repos/$REPO/actions/workflows/cd.yml/runs" "$(runs 0)"
# accepted, but no workflow_dispatch run ever appears
fixture "repos/$REPO/actions/workflows/cd.yml/runs.dispatch" "$(runs 0)"
OUT="$(run_script)"; RC=$?
if [ "$RC" != 0 ] && grep -q 'no workflow_dispatch run appeared' <<<"$OUT"; then
  pass "an accepted dispatch with no run appearing is a failure, not a success (exit status is not evidence of a run)"
else
  fail "accepted-but-absent: rc=$RC $OUT"
fi

reset
rm -f "$TMP/fx/repos_${REPO//\//_}_branches_main"
OUT="$(run_script)"; RC=$?
if [ "$RC" != 0 ] && grep -q 'Could not read the head' <<<"$OUT" && ! grep -q '^workflow run' "$TMP/log"; then
  pass "an unreadable branch head fails closed without dispatching anything"
else
  fail "unreadable head: rc=$RC log=$(cat "$TMP/log") $OUT"
fi

reset
fixture "repos/$REPO/actions/workflows/cd.yml/runs" "$(runs 1)"
OUT="$(run_script)"; RC=$?
if [ "$RC" != 0 ] && grep -q 'Could not list ci.yml runs' <<<"$OUT"; then
  pass "an unreadable run list is an error, never treated as zero runs"
else
  fail "unreadable run list: rc=$RC $OUT"
fi

echo ""
echo "=== wiring ==="
WF="$HERE/../../.github/workflows/deploy-drift.yml"
if [ -f "$WF" ] && grep -qF 'run: bash scripts/deploy-drift-dispatch.sh' "$WF"; then
  pass "deploy-drift.yml runs the script"
else
  fail "deploy-drift.yml does not run scripts/deploy-drift-dispatch.sh"
fi
if grep -qE '^\s*- cron: ' "$WF" && grep -qF 'workflow_dispatch:' "$WF"; then
  pass "deploy-drift.yml runs on a schedule and can be dispatched by hand"
else
  fail "deploy-drift.yml lacks a schedule or workflow_dispatch trigger"
fi
if grep -qE '^\s*actions: write' "$WF"; then
  pass "deploy-drift.yml grants actions: write (gh workflow run needs it)"
else
  fail "deploy-drift.yml does not grant actions: write — every dispatch would be refused"
fi
if grep -qF 'workflow_dispatch:' "$HERE/../../.github/workflows/cd.yml" && grep -qF 'workflow_dispatch:' "$HERE/../../.github/workflows/ci.yml"; then
  pass "cd.yml and ci.yml both accept workflow_dispatch"
else
  fail "a dispatched workflow has no workflow_dispatch trigger"
fi

echo ""
echo "  PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "SUITE PASSED"
  exit 0
fi
echo "SUITE FAILED"
exit 1
