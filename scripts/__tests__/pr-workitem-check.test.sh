#!/usr/bin/env bash
# Exercises the real ticket-verification run block from the workflow with a
# mocked gh client, so the test cannot drift from CI's decision logic.
set -uo pipefail

command -v python3 >/dev/null 2>&1 || { echo "python3 required"; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW="$HERE/../../.github/workflows/pr-workitem-check.yml"
FAILURES=0

VERIFY_SCRIPT="$(python3 - "$WORKFLOW" <<'PY'
import sys
lines = open(sys.argv[1]).read().splitlines()
i = next(i for i, line in enumerate(lines) if line.strip() == '- name: Verify ticket exists on GitHub Project')
j = next(i for i in range(i, len(lines)) if lines[i].strip() == 'run: |')
indent = len(lines[j]) - len(lines[j].lstrip())
body = []
for line in lines[j + 1:]:
    if line.strip() and len(line) - len(line.lstrip()) <= indent:
        break
    body.append(line)
common = min(len(line) - len(line.lstrip()) for line in body if line.strip())
print('\n'.join(line[common:] if line.strip() else '' for line in body))
PY
)"

run_case() {
  local scenario="$1" output="$2"
  local state
  state="$(mktemp)"
  : > "$state"
  MOCK_SCENARIO="$scenario" MOCK_STATE="$state" VERIFY_SCRIPT="$VERIFY_SCRIPT" PR_NUMBER=42 \
    PR_TITLE='fix: gate' PR_BODY='Closes #99; references PF-9999' PR_BRANCH='fix/gate' \
    bash -eo pipefail -c '
      gh() {
        if [ "$1 $2" = "pr view" ]; then
          [ "$MOCK_SCENARIO" = linked ] && echo 1 || echo 0
          return
        fi
        printf x >> "$MOCK_STATE"
        case "$MOCK_SCENARIO" in
          retry) [ "$(wc -c < "$MOCK_STATE")" -gt 1 ] && echo 1 || echo 0 ;;
          *) echo 0 ;;
        esac
      }
      sleep() { :; }
      export -f gh sleep
      eval "$VERIFY_SCRIPT"
    ' >"$output" 2>&1
  local status=$?
  rm -f "$state"
  return "$status"
}

check_pass() {
  local name="$1" scenario="$2" expected="$3" out
  out="$(mktemp)"
  if VERIFY_SCRIPT="$VERIFY_SCRIPT" run_case "$scenario" "$out" && grep -q "$expected" "$out"; then
    echo "  PASS: $name"
  else
    echo "  FAIL: $name"
    cat "$out"
    FAILURES=$((FAILURES + 1))
  fi
  rm -f "$out"
}

echo "=== PR work-item verification tests ==="
check_pass "a resolved closing issue bypasses PF search" linked 'PR closes 1 existing GitHub issue'
check_pass "an index miss is retried" retry 'PF-9999 exists on GitHub'

out="$(mktemp)"
if VERIFY_SCRIPT="$VERIFY_SCRIPT" run_case missing "$out"; then
  echo "  FAIL: an unlinked missing PF reference must fail"
  FAILURES=$((FAILURES + 1))
elif grep -q 'No closing issue is linked' "$out"; then
  echo "  PASS: an unlinked missing PF reference fails clearly"
else
  echo "  FAIL: missing-reference failure was not actionable"
  cat "$out"
  FAILURES=$((FAILURES + 1))
fi
rm -f "$out"

exit "$FAILURES"
