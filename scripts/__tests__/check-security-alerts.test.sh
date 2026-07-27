#!/usr/bin/env bash
# Unit tests for scripts/check-security-alerts.sh — the repo-level GitHub
# security-alert gate — plus structural assertions that it is wired into the
# scheduled security-alerts workflow with the right permissions and that no
# workflow line sets the test seams (which would no-op the gate).
#
# WHY THIS GATE EXISTS
# --------------------
# 10 Dependabot alerts (9× next, 1× @hono/node-server) and 1 CodeQL alert sat
# open on the repo with nothing watching them: npm-audit gates only see the
# lockfile at PR time, and CodeQL findings on main never block anything. This
# gate reads the ALERT APIs themselves — the same lists the GitHub Security tab
# shows — so an open alert becomes a red scheduled run instead of silent debt.
# It is scheduled, NOT PR-blocking, by design: repo-level alerts only close
# after the fixing PR merges, so a PR gate would deadlock its own fix.
#
# HERMETIC TESTING
# ----------------
# The gate reads its fetch commands from $GH_DEPENDABOT_CMD / $GH_CODESCAN_CMD
# (default: real `gh api` calls). These tests inject `cat <fixture>` stubs so
# the branching/exit-code contract is pinned without gh or the network. CI and
# the workflow never set the seams; the suite asserts that structurally.
set -uo pipefail

# SIGPIPE-safe matching: feed grep/awk from a here-string (`grep PAT <<<"$var"`),
# never pipe a large variable's `echo` into grep/awk — under pipefail the reader
# closing the pipe on first match SIGPIPEs the writer and misreports a real
# match as a miss. The suite-hygiene guard at the end fails on reintroduction.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../check-security-alerts.sh"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
WF_YML="$REPO_ROOT/.github/workflows/security-alerts.yml"
FAILURES=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ -f "$SCRIPT" ] || { echo "gate script not found: $SCRIPT"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required to run these tests"; exit 1; }

FIX="$(mktemp -d)"
trap 'rm -rf "$FIX"' EXIT

# Run the gate with injected fetch stubs. Echoes "<exit>|<output>".
run_gate() {
  local dep_cmd="$1" cs_cmd="$2" out rc
  out="$(GH_DEPENDABOT_CMD="$dep_cmd" GH_CODESCAN_CMD="$cs_cmd" bash "$SCRIPT" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}

fixture() { local name="$1"; cat > "$FIX/$name"; echo "$FIX/$name"; }

EMPTY="$(fixture empty.json <<'JSON'
[]
JSON
)"

echo "=== check-security-alerts.sh contract ==="

# --- 1. No open alerts anywhere → exit 0 --------------------------------------
res="$(run_gate "cat $EMPTY" "cat $EMPTY")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "no open alerts → exit 0"; else fail "no open alerts → expected 0, got $rc: $out"; fi

# --- 2. Open non-allowlisted Dependabot alert → exit 1, BLOCK line ------------
DEP_BLOCK="$(fixture dep-block.json <<'JSON'
[
  {
    "number": 12,
    "state": "open",
    "dependency": { "package": { "name": "next" } },
    "security_advisory": {
      "ghsa_id": "GHSA-89xv-2m56-2m9x",
      "severity": "high",
      "summary": "Next.js SSRF"
    }
  }
]
JSON
)"
res="$(run_gate "cat $DEP_BLOCK" "cat $EMPTY")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ] && grep -qF "BLOCK" <<<"$out" && grep -qF "GHSA-89xv-2m56-2m9x" <<<"$out"; then
  pass "open non-allowlisted Dependabot alert → exit 1 with BLOCK + GHSA id"
else
  fail "open Dependabot alert → expected 1 with BLOCK line, got $rc: $out"
fi

# --- 3. Open allowlisted Dependabot alert → exit 0, WAIVED line ----------------
DEP_WAIVED="$(fixture dep-waived.json <<'JSON'
[
  {
    "number": 3,
    "state": "open",
    "dependency": { "package": { "name": "esbuild" } },
    "security_advisory": {
      "ghsa_id": "GHSA-gv7w-rqvm-qjhr",
      "severity": "high",
      "summary": "esbuild Deno binary integrity"
    }
  }
]
JSON
)"
res="$(run_gate "cat $DEP_WAIVED" "cat $EMPTY")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ] && grep -qF "WAIVED" <<<"$out"; then
  pass "open allowlisted Dependabot alert → exit 0 with WAIVED line"
else
  fail "allowlisted Dependabot alert → expected 0 with WAIVED, got $rc: $out"
fi

# --- 4. Non-open alert in payload is ignored (defense vs. query drift) --------
DEP_FIXED="$(fixture dep-fixed.json <<'JSON'
[
  {
    "number": 5,
    "state": "fixed",
    "dependency": { "package": { "name": "next" } },
    "security_advisory": {
      "ghsa_id": "GHSA-p9j2-gv94-2wf4",
      "severity": "high",
      "summary": "already fixed"
    }
  }
]
JSON
)"
res="$(run_gate "cat $DEP_FIXED" "cat $EMPTY")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "non-open (fixed) Dependabot alert is ignored"; else fail "fixed alert should be ignored → expected 0, got $rc: $out"; fi

# --- 5. Open code-scanning alert → exit 1 --------------------------------------
CS_BLOCK="$(fixture cs-block.json <<'JSON'
[
  {
    "number": 60,
    "state": "open",
    "rule": { "id": "js/incomplete-multi-character-sanitization", "security_severity_level": "high" },
    "most_recent_instance": {
      "location": { "path": "tools/agentic-sync/sync.mjs", "start_line": 127 }
    }
  }
]
JSON
)"
res="$(run_gate "cat $EMPTY" "cat $CS_BLOCK")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ] && grep -qF "js/incomplete-multi-character-sanitization" <<<"$out"; then
  pass "open code-scanning alert → exit 1 naming the rule"
else
  fail "open code-scanning alert → expected 1 naming rule, got $rc: $out"
fi

# --- 6. Violations on both surfaces are BOTH counted ---------------------------
res="$(run_gate "cat $DEP_BLOCK" "cat $CS_BLOCK")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ] && grep -qF "2 open" <<<"$out"; then
  pass "dependabot + code-scanning violations both counted (2 open)"
else
  fail "both-surface violations → expected 1 with '2 open' in summary, got $rc: $out"
fi

# --- 7. Paginated (concatenated JSON documents) input is fully evaluated -------
DEP_PAGED="$(fixture dep-paged.json <<'JSON'
[]
[
  {
    "number": 9,
    "state": "open",
    "dependency": { "package": { "name": "@hono/node-server" } },
    "security_advisory": {
      "ghsa_id": "GHSA-frvp-7c67-39w9",
      "severity": "medium",
      "summary": "serve-static path traversal"
    }
  }
]
JSON
)"
res="$(run_gate "cat $DEP_PAGED" "cat $EMPTY")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ] && grep -qF "GHSA-frvp-7c67-39w9" <<<"$out"; then
  pass "alert on a later --paginate page is still evaluated"
else
  fail "paginated input → expected 1 with the page-2 GHSA id, got $rc: $out"
fi

# --- 8. Malformed JSON → exit 2 (fail closed) -----------------------------------
BAD="$(fixture bad.json <<'JSON'
{"this is": not json
JSON
)"
res="$(run_gate "cat $BAD" "cat $EMPTY")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "2" ]; then pass "malformed dependabot JSON → exit 2 (fail closed)"; else fail "malformed JSON → expected 2, got $rc: $out"; fi

res="$(run_gate "cat $EMPTY" "cat $BAD")"
rc="${res%%|*}"
if [ "$rc" = "2" ]; then pass "malformed code-scanning JSON → exit 2 (fail closed)"; else fail "malformed code-scanning JSON → expected 2, got $rc"; fi

# --- 9. Non-array JSON (e.g. an API error object) → exit 2 ----------------------
ERR_OBJ="$(fixture err-obj.json <<'JSON'
{"message": "API rate limit exceeded", "documentation_url": "https://docs.github.com"}
JSON
)"
res="$(run_gate "cat $ERR_OBJ" "cat $EMPTY")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "2" ]; then pass "API error object instead of array → exit 2 (fail closed)"; else fail "error-object payload → expected 2, got $rc: $out"; fi
# The error body's .message must reach the log — an opaque shape error hid the
# real cause ("Resource not accessible by integration") on the first live run.
if grep -qF "API rate limit exceeded" <<<"$out"; then
  pass "API error object's .message is surfaced in the failure output"
else
  fail "expected the API error message to be surfaced, got: $out"
fi

# --- 10. Fetch command failing with no output → exit 2 --------------------------
res="$(run_gate "false" "cat $EMPTY")"
rc="${res%%|*}"
if [ "$rc" = "2" ]; then pass "failing fetch command → exit 2 (fail closed)"; else fail "failing fetch → expected 2, got $rc"; fi

# --- 11. Anti-rot note when an allowlisted GHSA id is absent ---------------------
res="$(run_gate "cat $EMPTY" "cat $EMPTY")"
out="${res#*|}"
if grep -qF "note" <<<"$out" && grep -qF "GHSA-gv7w-rqvm-qjhr" <<<"$out"; then
  pass "absent allowlisted id emits an anti-rot note"
else
  fail "expected anti-rot note naming GHSA-gv7w-rqvm-qjhr when absent: $out"
fi

echo ""
echo "=== workflow wiring (structural) ==="
if [ -f "$WF_YML" ]; then
  wf="$(cat "$WF_YML")"

  if grep -qF 'security-events: read' <<<"$wf"; then
    pass "workflow grants security-events: read (covers the code-scanning API)"
  else
    fail "workflow missing 'security-events: read' permission"
  fi

  # The Actions GITHUB_TOKEN cannot read the Dependabot alerts API (the Actions
  # app has no such permission), so GH_TOKEN must prefer the fine-grained PAT
  # secret, with github.token only as the fail-closed fallback.
  # The ${{ }} below is a literal Actions expression, not a shell expansion.
  # shellcheck disable=SC2016
  if grep -qF 'GH_TOKEN: ${{ secrets.SECURITY_ALERTS_TOKEN || github.token }}' <<<"$wf"; then
    pass "workflow GH_TOKEN prefers SECURITY_ALERTS_TOKEN with github.token fallback"
  else
    fail "workflow GH_TOKEN must be \${{ secrets.SECURITY_ALERTS_TOKEN || github.token }} — github.token alone cannot read Dependabot alerts"
  fi

  if grep -qF 'bash scripts/check-security-alerts.sh' <<<"$wf"; then
    pass "workflow runs the gate script"
  else
    fail "workflow does not run scripts/check-security-alerts.sh"
  fi

  if grep -qE '^\s*schedule:' <<<"$wf" && grep -qF 'workflow_dispatch:' <<<"$wf"; then
    pass "workflow has a schedule and workflow_dispatch trigger"
  else
    fail "workflow missing schedule and/or workflow_dispatch trigger"
  fi

  # The seams exist ONLY for this suite. A workflow line setting either would
  # replace the real API reads and no-op the gate.
  if grep -qE 'GH_DEPENDABOT_CMD|GH_CODESCAN_CMD' <<<"$wf"; then
    fail "workflow sets a test seam (GH_DEPENDABOT_CMD/GH_CODESCAN_CMD) — gate would be no-oped"
  else
    pass "workflow does not set the test seams"
  fi

  if grep -qF 'continue-on-error' <<<"$wf"; then
    fail "workflow uses continue-on-error — a red gate must stay red"
  else
    pass "workflow has no continue-on-error shadowing the gate"
  fi
else
  fail "workflow not found at $WF_YML"
fi

echo ""
echo "=== suite hygiene (structural) ==="
# Regression lock for the SIGPIPE-under-pipefail false failure (see header). The
# needle glues `echo` to `[[:space:]]` so this guard line cannot match itself.
SELF="${BASH_SOURCE[0]}"
if grep -nE 'echo[[:space:]]+"\$[A-Za-z_][A-Za-z0-9_]*"[[:space:]]*\|[[:space:]]*(grep|awk)' "$SELF" >/dev/null; then
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
