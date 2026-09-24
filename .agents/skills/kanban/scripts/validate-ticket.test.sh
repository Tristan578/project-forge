#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

cat > "$TMP_DIR/curl" <<'CURL'
#!/usr/bin/env bash
set -euo pipefail
out=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w|--max-time) shift 2 ;;
    -s|-sS) shift ;;
    *) url="$1"; shift ;;
  esac
done

if [[ "$url" == */board ]]; then
  printf '{}'
  exit 0
fi

id="${url##*/}"
status=200
case "$id" in
  good)
    body='{"title":"A meaningful ticket title","description":"As an engineer, I want validation so that tickets stay useful. Given a valid ticket, When validation runs, Then it passes. Given labels exist, When validation runs, Then they are shown. Given subtasks exist, When validation runs, Then they are counted.","priority":"high","labels":["bug"],"teamId":"engineering","subtasks":[1,2,3]}' ;;
  literal-404)
    body='{"title":"Fix documented 404 handling","description":"As an engineer, I want 404 errors documented so that dead routes are fixed. Given a route returns 404, When validation runs, Then content is checked. Given an error is described, When validation runs, Then fetching still succeeds. Given a fix exists, When reviewed, Then it passes.","priority":"high","labels":["bug"],"teamId":"engineering","subtasks":[1,2,3]}' ;;
  two-scenarios)
    body='{"title":"Only two acceptance scenarios","description":"As an engineer, I want validation so that weak tickets fail. Given one case, When checked, Then it runs. Given another case, When checked, Then it also runs.","priority":"high","labels":["bug"],"teamId":"engineering","subtasks":[1,2,3]}' ;;
  prose-only)
    body='{"title":"Prose is not acceptance criteria","description":"As an engineer, I want formal scenarios so that prose cannot fake coverage. This ticket is given several constraints; when each is evaluated, then a decision follows. It is also given a budget; when costs rise, then caching helps. Finally, given limited time, when delivery approaches, then scope narrows.","priority":"high","labels":["bug"],"teamId":"engineering","subtasks":[1,2,3]}' ;;
  malformed)
    body='{"title":"Too short","description":"missing sections","priority":"","labels":[],"subtasks":[]}' ;;
  # Each of these differs from `good` in exactly one field.
  no-subtasks)
    body='{"title":"A meaningful ticket title","description":"As an engineer, I want validation so that tickets stay useful. Given a valid ticket, When validation runs, Then it passes. Given labels exist, When validation runs, Then they are shown. Given subtasks exist, When validation runs, Then they are counted.","priority":"high","labels":["bug"],"teamId":"engineering","subtasks":[1]}' ;;
  no-labels)
    body='{"title":"A meaningful ticket title","description":"As an engineer, I want validation so that tickets stay useful. Given a valid ticket, When validation runs, Then it passes. Given labels exist, When validation runs, Then they are shown. Given subtasks exist, When validation runs, Then they are counted.","priority":"high","labels":[],"teamId":"engineering","subtasks":[1,2,3]}' ;;
  bad-priority)
    body='{"title":"A meaningful ticket title","description":"As an engineer, I want validation so that tickets stay useful. Given a valid ticket, When validation runs, Then it passes. Given labels exist, When validation runs, Then they are shown. Given subtasks exist, When validation runs, Then they are counted.","priority":"p9","labels":["bug"],"teamId":"engineering","subtasks":[1,2,3]}' ;;
  short-title)
    body='{"title":"Too short","description":"As an engineer, I want validation so that tickets stay useful. Given a valid ticket, When validation runs, Then it passes. Given labels exist, When validation runs, Then they are shown. Given subtasks exist, When validation runs, Then they are counted.","priority":"high","labels":["bug"],"teamId":"engineering","subtasks":[1,2,3]}' ;;
  *) status=404; body='{"error":"not found"}' ;;
esac

printf '%s' "$body" > "$out"
printf '%s' "$status"
CURL
chmod +x "$TMP_DIR/curl"

run_validator() {
  # tr: Python on Windows ends lines with CRLF, which would defeat the `$`
  # anchors below on a Git Bash run while passing on Linux.
  PATH="$TMP_DIR:$PATH" bash "$SCRIPT_DIR/validate-ticket.sh" "$1" 2>&1 | tr -d '\r'
}

# `! grep -q ...` cannot fail under `set -e`: bash exempts a negated command
# from errexit, so it would pass whatever the output held. Fail explicitly.
refute() {
  if grep -q -- "$1" <<< "$2"; then
    echo "FAIL: output unexpectedly contains '$1'" >&2
    exit 1
  fi
}

good=$(run_validator good)
grep -q 'RESULT: PASS' <<< "$good"
refute 'Traceback' "$good"
refute '\[FAIL\]' "$good"

literal=$(run_validator literal-404)
grep -q 'RESULT: PASS' <<< "$literal"
refute 'Could not fetch' "$literal"

# The verdict must agree with the rows: every [FAIL] row fails the ticket.
# `.*` stands in for the em dash, which Python on Windows prints as cp1252.
no_subtasks=$(run_validator no-subtasks)
grep -q 'RESULT: FAIL .* missing: subtasks$' <<< "$no_subtasks"

bad_priority=$(run_validator bad-priority)
grep -q 'RESULT: FAIL .* missing: priority$' <<< "$bad_priority"

short_title=$(run_validator short-title)
grep -q 'RESULT: FAIL .* missing: title$' <<< "$short_title"

# Labels are a SHOULD in the template: a warning, never a failure.
no_labels=$(run_validator no-labels)
grep -q 'Labels set.*\[WARN\]' <<< "$no_labels"
grep -q 'RESULT: PASS' <<< "$no_labels"
refute '\[FAIL\]' "$no_labels"

two=$(run_validator two-scenarios)
grep -q 'RESULT: FAIL' <<< "$two"
grep -q 'missing: acceptance criteria' <<< "$two"

prose=$(run_validator prose-only)
grep -q 'RESULT: FAIL' <<< "$prose"
grep -q 'missing: acceptance criteria' <<< "$prose"

malformed=$(run_validator malformed)
grep -q 'RESULT: FAIL' <<< "$malformed"
grep -q 'user story' <<< "$malformed"
grep -q 'acceptance criteria' <<< "$malformed"

missing=$(run_validator missing)
grep -q 'Could not fetch' <<< "$missing"
grep -q 'HTTP status: 404' <<< "$missing"

echo 'validate-ticket tests passed'
