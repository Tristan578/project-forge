#!/usr/bin/env bash
# Tests for .claude/hooks/taskboard-launch.mjs — the ONE entry point every
# taskboard start goes through (#9995 / #10291). `.mcp.json` dials it for the
# MCP server; the hooks, rules, skills and READMEs now tell an operator to run
# `node .claude/hooks/taskboard-launch.mjs start`. That guidance is only honest
# if the launcher really forwards `start` (and every other subcommand) to
# taskboard_runtime.py, on a host where `python3` may not be a valid executable
# name (CPython for Windows ships python.exe) — so this suite drives the real
# launcher, not a description of it.
#
# Hermetic: TASKBOARD_DB points into a temp dir and TASKBOARD_API at a locally
# refused port, so no server is contacted, no binary is spawned, and the
# runtime's own pre-spawn guard is what answers.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER="$HERE/../taskboard-launch.mjs"
[ -f "$LAUNCHER" ] || { echo "FAIL launcher not found: $LAUNCHER"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "FAIL node is required to run this suite (the launcher is a node script)"; exit 1; }

pass=0
fail=0
ok()  { echo "  PASS: $1"; pass=$((pass + 1)); }
readonly -f ok
bad() { echo "  FAIL: $1"; fail=$((fail + 1)); }
readonly -f bad

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export PYTHONDONTWRITEBYTECODE=1

# run_launcher <subcommand> [VAR=value ...] — prints "<exit>|<output>".
run_launcher() {
  local sub="$1" out rc
  shift
  out="$(env "$@" TASKBOARD_API="http://127.0.0.1:0/api" node "$LAUNCHER" "$sub" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}
readonly -f run_launcher

echo "=== taskboard-launch.mjs tests ==="

# ---- 1. argv forwarding: db-path prints the runtime's resolved path ---------
sentinel="$TMP/forwarded/taskboard.db"
res="$(run_launcher db-path TASKBOARD_DB="$sentinel")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" -eq 0 ] && grep -qF "forwarded" <<<"$out" && grep -qF "taskboard.db" <<<"$out"; then
  ok "1. 'db-path' is forwarded to taskboard_runtime.py and prints the resolved path"
else
  bad "1. expected exit 0 with the sentinel path, got exit $rc: $out"
fi

# ---- 2. 'start' reaches ensure_running(): a missing database is refused ------
#      BEFORE any spawn, and nothing is created on disk (#10291 security finding).
absent="$TMP/never-created/taskboard.db"
res="$(run_launcher start TASKBOARD_DB="$absent")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" -eq 1 ] && grep -qF "Taskboard database is missing" <<<"$out"; then
  ok "2. 'start' is forwarded and refuses a missing database with exit 1"
else
  bad "2. expected exit 1 + 'Taskboard database is missing', got exit $rc: $out"
fi
if [ ! -e "$absent" ] && [ ! -e "$TMP/never-created" ]; then
  ok "2b. no database file or directory was created by the refused start"
else
  bad "2b. the refused start created something under $TMP/never-created"
fi

# ---- 3. an unusable PYTHON override falls through to a real interpreter -----
#      (the probe loop is the whole reason the launcher exists: 'python3' is
#      not a valid executable name on Windows CPython, so a bad first guess
#      must not be fatal).
res="$(run_launcher db-path TASKBOARD_DB="$sentinel" PYTHON="definitely-not-a-python-$$")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" -eq 0 ] && grep -qF "forwarded" <<<"$out"; then
  ok "3. a non-existent PYTHON override falls back to the next candidate interpreter"
else
  bad "3. expected the probe loop to fall back, got exit $rc: $out"
fi

echo
echo "taskboard-launch.test.sh: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
