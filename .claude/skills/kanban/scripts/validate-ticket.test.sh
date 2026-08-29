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
  *) status=404; body='{"error":"not found"}' ;;
esac

printf '%s' "$body" > "$out"
printf '%s' "$status"
CURL
chmod +x "$TMP_DIR/curl"

run_validator() {
  PATH="$TMP_DIR:$PATH" bash "$SCRIPT_DIR/validate-ticket.sh" "$1" 2>&1
}

good=$(run_validator good)
grep -q 'RESULT: PASS' <<< "$good"
! grep -q 'Traceback' <<< "$good"

literal=$(run_validator literal-404)
grep -q 'RESULT: PASS' <<< "$literal"
! grep -q 'Could not fetch' <<< "$literal"

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
