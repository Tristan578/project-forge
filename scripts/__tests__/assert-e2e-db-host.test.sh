#!/usr/bin/env bash
# Contract test for scripts/assert-e2e-db-host.sh — the guard that keeps the
# engine-journeys job on the database it provisioned (#10161).
#
# WHY THIS SUITE EXISTS
#
# The journeys job migrates, drift-checks and then serves the app against
# whatever DATABASE_URL names. The value is a job-level literal today, but a
# literal is one edit away from a Neon branch string, and nothing downstream
# would notice: migrate would apply to that branch, drift would read clean,
# /api/health would report `connected`, and the board would be green while a
# required check ran against shared data. The guard is the step that refuses
# that, so this suite pins both halves of it:
#
#   1. the script's own behaviour against foreign hosts, missing variables,
#      odd-but-valid URLs (an `@` in the password, an IPv6 literal) and the
#      operator override; and that it never prints a credential;
#   2. the wiring in ci.yml — the guard runs in the journeys job, before
#      migrate, and the job's own literals name the loopback host — read from
#      a comment-stripped copy of the workflow, so a deleted step with an
#      explanatory comment left behind cannot satisfy a pin (lesson #16).
#
# Assertions use explicit if/then/else (NOT `A && ok || bad`) so this suite has
# no SC2015 findings — CI's self-defense job shellchecks it.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$HERE/../assert-e2e-db-host.sh"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
CI_YML="${ASSERT_E2E_DB_HOST_CI_YML:-$REPO_ROOT/.github/workflows/ci.yml}"

PASS=0
FAIL=0
pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
readonly -f pass
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }
readonly -f fail

[ -f "$GUARD" ] || { echo "guard script not found: $GUARD"; exit 1; }

echo "=== assert-e2e-db-host.sh ==="

# run_guard <DATABASE_URL> <E2E_NEON_HTTP_ENDPOINT> [E2E_DB_EXPECTED_HOST]
# Prints "<exit code>|<combined output>". Variables are passed through the
# environment only, exactly as the workflow passes them — the guard takes no
# arguments, so a connection string can never land in a process list.
# An empty argument UNSETS the variable rather than exporting an empty string,
# so the "missing" cases exercise the absent-variable branch the job would hit.
run_guard() {
  local url="$1" ep="$2" expected="${3-}" out rc
  out="$(
    if [ -n "$url" ]; then export DATABASE_URL="$url"; else unset DATABASE_URL; fi
    if [ -n "$ep" ]; then export E2E_NEON_HTTP_ENDPOINT="$ep"; else unset E2E_NEON_HTTP_ENDPOINT; fi
    if [ -n "$expected" ]; then export E2E_DB_EXPECTED_HOST="$expected"; else unset E2E_DB_EXPECTED_HOST; fi
    bash "$GUARD" 2>&1
  )"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}
readonly -f run_guard

LOCAL_URL='postgres://postgres:postgres@localhost:5432/spawnforge_journeys'
LOCAL_EP='http://localhost:4444/sql'

# --- 1. the happy path: both hosts are the loopback the job provisioned ------
res="$(run_guard "$LOCAL_URL" "$LOCAL_EP")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "localhost DATABASE_URL + localhost endpoint passes (exit 0)"; else fail "expected exit 0 for the provisioned loopback host, got $rc: $out"; fi
if grep -q "localhost" <<<"$out"; then pass "the verified host is named in the output"; else fail "output does not name the verified host: $out"; fi

# --- 2. a foreign DATABASE_URL host is refused, naming both hosts -------------
NEON_URL='postgres://neondb_owner:npg_secret@ep-cool-sun-a1b2c3d4.us-east-2.aws.neon.tech/neondb?sslmode=require'
res="$(run_guard "$NEON_URL" "$LOCAL_EP")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "a Neon branch host is refused (exit 1)"; else fail "expected exit 1 for a Neon host, got $rc: $out"; fi
if grep -q "ep-cool-sun-a1b2c3d4.us-east-2.aws.neon.tech" <<<"$out"; then pass "the foreign host is named"; else fail "the foreign host is not named: $out"; fi
if grep -q "localhost" <<<"$out"; then pass "the expected host is named beside it"; else fail "the expected host is not named: $out"; fi
if grep -q "npg_secret" <<<"$out"; then fail "the password leaked into the guard's output"; else pass "the password never appears in the output"; fi
if grep -q "neondb_owner" <<<"$out"; then fail "the user name leaked into the guard's output"; else pass "the user name never appears in the output"; fi

# --- 3. an IP literal is not the provisioned name (strict equality) -----------
# The proxy's HTTP path derives the endpoint id from the hostname's first label
# and rejects an IP literal outright, so `127.0.0.1` is not merely different —
# it is a URL the driver cannot use. Strict equality keeps that visible.
res="$(run_guard 'postgres://postgres:postgres@127.0.0.1:5432/db' "$LOCAL_EP")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "127.0.0.1 is refused when the expected host is localhost (exit 1)"; else fail "expected exit 1 for an IP literal, got $rc: $out"; fi

# --- 4. a foreign endpoint host is refused even with a local DATABASE_URL -----
res="$(run_guard "$LOCAL_URL" 'https://ep-cool-sun-a1b2c3d4.us-east-2.aws.neon.tech/sql')"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "a foreign E2E_NEON_HTTP_ENDPOINT host is refused (exit 1)"; else fail "expected exit 1 for a foreign endpoint, got $rc: $out"; fi
if grep -q "E2E_NEON_HTTP_ENDPOINT" <<<"$out"; then pass "the endpoint variable is named"; else fail "the endpoint variable is not named: $out"; fi

# --- 5. missing variables fail closed, naming the variable --------------------
res="$(run_guard '' "$LOCAL_EP")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "a missing DATABASE_URL fails (exit 1)"; else fail "expected exit 1 without DATABASE_URL, got $rc: $out"; fi
if grep -q "DATABASE_URL" <<<"$out"; then pass "DATABASE_URL is named as missing"; else fail "missing DATABASE_URL is not named: $out"; fi
res="$(run_guard "$LOCAL_URL" '')"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "a missing E2E_NEON_HTTP_ENDPOINT fails (exit 1) — without it the driver would post to Neon cloud"; else fail "expected exit 1 without E2E_NEON_HTTP_ENDPOINT, got $rc: $out"; fi
if grep -q "E2E_NEON_HTTP_ENDPOINT" <<<"$out"; then pass "E2E_NEON_HTTP_ENDPOINT is named as missing"; else fail "missing E2E_NEON_HTTP_ENDPOINT is not named: $out"; fi

# --- 6. the scheme must be postgres(ql):// and the endpoint http(s):// --------
res="$(run_guard 'mysql://postgres:postgres@localhost:3306/db' "$LOCAL_EP")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "a non-postgres scheme is refused (exit 1)"; else fail "expected exit 1 for mysql://, got $rc: $out"; fi
res="$(run_guard 'postgresql://postgres:postgres@localhost:5432/db' "$LOCAL_EP")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "the postgresql:// spelling is accepted (exit 0)"; else fail "expected exit 0 for postgresql://, got $rc: $out"; fi
res="$(run_guard "$LOCAL_URL" 'ws://localhost:4444/sql')"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "a non-http endpoint scheme is refused (exit 1)"; else fail "expected exit 1 for ws://, got $rc: $out"; fi

# --- 7. the host is parsed, not substring-matched -----------------------------
# A password carrying '@' and a hostname carrying 'localhost' as a label are the
# two ways a naive split or grep reads the wrong host.
res="$(run_guard 'postgres://postgres:p%40ss@word@localhost:5432/db' "$LOCAL_EP")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "an '@' in the password does not shift the host (exit 0)"; else fail "expected exit 0 with '@' in the password, got $rc: $out"; fi
if grep -q "p%40ss@word" <<<"$out"; then fail "the password leaked into the output"; else pass "the '@'-bearing password never appears in the output"; fi
res="$(run_guard 'postgres://postgres:postgres@localhost.evil.example:5432/db' "$LOCAL_EP")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "'localhost.evil.example' is not 'localhost' (exit 1)"; else fail "a hostname merely containing localhost passed: $out"; fi
res="$(run_guard 'postgres://postgres:postgres@notlocalhost:5432/db' "$LOCAL_EP")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "'notlocalhost' is not 'localhost' (exit 1)"; else fail "a hostname ending in localhost passed: $out"; fi
res="$(run_guard 'postgres://postgres:postgres@localhost/db' "$LOCAL_EP")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "a URL without an explicit port still parses its host (exit 0)"; else fail "expected exit 0 without a port, got $rc: $out"; fi

# --- 8. the expected host is an operator override, bracketed IPv6 included ----
res="$(run_guard 'postgres://postgres:postgres@db.localtest.me:5432/db' 'http://db.localtest.me:4444/sql' 'db.localtest.me')"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "E2E_DB_EXPECTED_HOST overrides the expected host (exit 0)"; else fail "expected exit 0 with the override, got $rc: $out"; fi
res="$(run_guard "$LOCAL_URL" "$LOCAL_EP" 'db.localtest.me')"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "localhost is refused when the override expects another name (exit 1)"; else fail "expected exit 1 against the override, got $rc: $out"; fi
res="$(run_guard 'postgres://postgres:postgres@[::1]:5432/db' 'http://[::1]:4444/sql' '::1')"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "a bracketed IPv6 literal compares as its bare address (exit 0)"; else fail "expected exit 0 for [::1], got $rc: $out"; fi

# --- 9. the guard takes no arguments: a URL on argv is refused ----------------
out="$(DATABASE_URL="$LOCAL_URL" E2E_NEON_HTTP_ENDPOINT="$LOCAL_EP" bash "$GUARD" "$LOCAL_URL" 2>&1)"; rc=$?
if [ "$rc" = "1" ]; then pass "an argument is refused (a connection string must never sit on a command line) (exit 1)"; else fail "expected exit 1 with an argument, got $rc: $out"; fi

# --- 10. the authority is not the whole story: query overrides and backslashes -
# libpq (and psql, which the proxy's start.sh runs against its own connection
# string, and the Rust postgres config) honour `host=` / `hostaddr=` /
# `service=` in the query string OVER the URL's authority, so
# `postgres://u:p@localhost/db?host=evil.example` names `localhost` to a parser
# that reads only the authority and connects to evil.example. The job's literal
# carries no query at all, so ANY `?` on DATABASE_URL is refused rather than
# enumerating the parameters that redirect a connection.
#
# A backslash is the other way two parsers read one URL as two hosts: the WHATWG
# parser that fetch() uses treats `\` as `/` in an http URL, so
# `http://evil.example\@localhost/sql` is host evil.example to the driver and
# `localhost` to a last-`@` split. Neither URL in the job has a backslash, so
# either variable carrying one is refused outright.
for q in '?host=evil.example' '?hostaddr=203.0.113.9' '?service=prod' '?'; do
  res="$(run_guard "postgres://postgres:postgres@localhost:5432/db${q}" "$LOCAL_EP")"
  rc="${res%%|*}"; out="${res#*|}"
  if [ "$rc" = "1" ]; then pass "a DATABASE_URL query string '${q}' is refused even though its authority is localhost (exit 1)"; else fail "DATABASE_URL query '${q}' passed the guard (exit $rc): $out"; fi
  if grep -q "DATABASE_URL" <<<"$out" && grep -qi "query" <<<"$out"; then pass "the refusal for '${q}' names DATABASE_URL and says why (a query string)"; else fail "the refusal for '${q}' does not name DATABASE_URL and the query string: $out"; fi
done
# Even a benign parameter is refused: the rule is "no query", not a denylist.
res="$(run_guard 'postgres://postgres:postgres@localhost:5432/db?sslmode=disable' "$LOCAL_EP")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "a benign '?sslmode=disable' is refused too — any query, not a denylist (exit 1)"; else fail "expected exit 1 for a benign query string, got $rc: $out"; fi
# The refusal must not echo the query: it can carry a password= or a token.
res="$(run_guard 'postgres://postgres:postgres@localhost:5432/db?host=evil.example&password=hunter2' "$LOCAL_EP")"
rc="${res%%|*}"; out="${res#*|}"
if grep -q "hunter2" <<<"$out" || grep -q "evil.example" <<<"$out"; then fail "the refusal echoed the query string: $out"; else pass "the refusal never echoes the query string"; fi
# A '?' in the userinfo is still a '?' — refused, not parsed around.
res="$(run_guard 'postgres://postgres:pa?ss@localhost:5432/db' "$LOCAL_EP")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "a raw '?' in the userinfo is refused (exit 1)"; else fail "expected exit 1 for a '?' in the password, got $rc: $out"; fi

res="$(run_guard "$LOCAL_URL" 'http://evil.example\@localhost/sql')"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "a backslash-userinfo endpoint 'http://evil.example\\@localhost/sql' is refused (exit 1)"; else fail "the backslash-userinfo endpoint passed the guard (exit $rc): $out"; fi
if grep -q "E2E_NEON_HTTP_ENDPOINT" <<<"$out" && grep -qi "backslash" <<<"$out"; then pass "the refusal names E2E_NEON_HTTP_ENDPOINT and the backslash"; else fail "the refusal does not name E2E_NEON_HTTP_ENDPOINT and the backslash: $out"; fi
res="$(run_guard 'postgres://postgres:postgres@evil.example\@localhost:5432/db' "$LOCAL_EP")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "a backslash in DATABASE_URL is refused (exit 1)"; else fail "a backslash in DATABASE_URL passed the guard (exit $rc): $out"; fi
if grep -q "DATABASE_URL" <<<"$out" && grep -qi "backslash" <<<"$out"; then pass "the refusal names DATABASE_URL and the backslash"; else fail "the refusal does not name DATABASE_URL and the backslash: $out"; fi
# A backslash anywhere, not only in the userinfo.
res="$(run_guard "$LOCAL_URL" 'http://localhost:4444\sql')"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "a backslash in the endpoint's path position is refused (exit 1)"; else fail "a backslash in the endpoint path passed the guard (exit $rc): $out"; fi

echo ""
echo "=== ci.yml wiring: the guard runs in the journeys job, before migrate ==="
# Comment-stripped first. A deleted step with an explanatory comment left in
# its place must not satisfy any pin below (lesson #16).
if [ ! -f "$CI_YML" ]; then
  fail "ci.yml not found at $CI_YML — the wiring pins below would pass vacuously"
else
  ci_exec="$(grep -v '^[[:space:]]*#' "$CI_YML" | sed 's/[[:space:]]#.*$//')"
  job_blk="$(awk '
    /^  test-e2e-engine-journeys:[[:space:]]*$/ {f=1}
    f && /^  [A-Za-z_][A-Za-z0-9_-]*:[[:space:]]*$/ && !/^  test-e2e-engine-journeys:/ {exit}
    f {print}
  ' <<<"$ci_exec")"
  if [ -z "$job_blk" ]; then
    fail "ci.yml has no test-e2e-engine-journeys job — nothing provisions a per-run database, so the guard protects nothing"
  else
    pass "ci.yml defines the test-e2e-engine-journeys job"
    guard_n="$(grep -c 'bash scripts/assert-e2e-db-host.sh' <<<"$job_blk" || true)"
    migrate_n="$(grep -c 'npm run db:migrate' <<<"$job_blk" || true)"
    drift_n="$(grep -c 'npm run db:drift' <<<"$job_blk" || true)"
    play_n="$(grep -c 'playwright test --config playwright.journeys.config.ts' <<<"$job_blk" || true)"
    if [ "$guard_n" -eq 1 ]; then pass "the job runs the guard exactly once (executable lines)"; else fail "the job runs the guard $guard_n time(s), expected exactly 1 — the host check is missing or duplicated"; fi
    if [ "$migrate_n" -eq 1 ]; then pass "the job migrates exactly once"; else fail "the job runs db:migrate $migrate_n time(s), expected exactly 1"; fi
    if [ "$drift_n" -eq 1 ]; then pass "the job checks schema drift exactly once"; else fail "the job runs db:drift $drift_n time(s), expected exactly 1"; fi
    if [ "$play_n" -eq 1 ]; then pass "the job runs the journeys Playwright config exactly once"; else fail "the job runs the journeys config $play_n time(s), expected exactly 1"; fi
    guard_line="$(grep -n 'bash scripts/assert-e2e-db-host.sh' <<<"$job_blk" | head -1 | cut -d: -f1)"
    migrate_line="$(grep -n 'npm run db:migrate' <<<"$job_blk" | head -1 | cut -d: -f1)"
    drift_line="$(grep -n 'npm run db:drift' <<<"$job_blk" | head -1 | cut -d: -f1)"
    play_line="$(grep -n 'playwright test --config playwright.journeys.config.ts' <<<"$job_blk" | head -1 | cut -d: -f1)"
    if [ -n "$guard_line" ] && [ -n "$migrate_line" ] && [ "$guard_line" -lt "$migrate_line" ]; then
      pass "the guard runs BEFORE db:migrate (line $guard_line < $migrate_line in the job)"
    else
      fail "the guard does not precede db:migrate (guard=${guard_line:-absent}, migrate=${migrate_line:-absent}) — a foreign database would be migrated before the host is checked"
    fi
    if [ -n "$migrate_line" ] && [ -n "$drift_line" ] && [ "$migrate_line" -lt "$drift_line" ]; then
      pass "db:migrate runs BEFORE db:drift"
    else
      fail "db:drift does not follow db:migrate (migrate=${migrate_line:-absent}, drift=${drift_line:-absent})"
    fi
    if [ -n "$drift_line" ] && [ -n "$play_line" ] && [ "$drift_line" -lt "$play_line" ]; then
      pass "migrate and drift both run BEFORE Playwright starts"
    else
      fail "Playwright does not follow db:drift (drift=${drift_line:-absent}, playwright=${play_line:-absent}) — a migration that cannot apply must fail the job before any spec runs"
    fi
    # The job's own literals. The guard would catch a drift at run time; this
    # catches it at review time, and proves the suite's happy path is the
    # workflow's real configuration rather than a value the suite made up.
    db_url_val="$(grep -E '^      DATABASE_URL:' <<<"$job_blk" | head -1 | sed -E "s/^      DATABASE_URL:[[:space:]]*//; s/^['\"]//; s/['\"][[:space:]]*$//")"
    ep_val="$(grep -E '^      E2E_NEON_HTTP_ENDPOINT:' <<<"$job_blk" | head -1 | sed -E "s/^      E2E_NEON_HTTP_ENDPOINT:[[:space:]]*//; s/^['\"]//; s/['\"][[:space:]]*$//")"
    if [ -z "$db_url_val" ] || [ -z "$ep_val" ]; then
      fail "the job env does not set both DATABASE_URL and E2E_NEON_HTTP_ENDPOINT as job-level literals (db='${db_url_val:-absent}', endpoint='${ep_val:-absent}')"
    else
      res="$(run_guard "$db_url_val" "$ep_val")"
      rc="${res%%|*}"; out="${res#*|}"
      if [ "$rc" = "0" ]; then pass "the job's own DATABASE_URL and E2E_NEON_HTTP_ENDPOINT literals pass the guard"; else fail "the job's own literals FAIL the guard (exit $rc): $out"; fi
    fi
    if grep -qE 'E2E_DB_EXPECTED_HOST' <<<"$job_blk"; then
      fail "the job sets E2E_DB_EXPECTED_HOST — the override exists for a local operator, not for the workflow to redefine what 'the host this run provisioned' means"
    else
      pass "the job does not override the expected host"
    fi
  fi
fi

echo ""
echo "  PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "SUITE PASSED"
  exit 0
fi
echo "SUITE FAILED"
exit 1
