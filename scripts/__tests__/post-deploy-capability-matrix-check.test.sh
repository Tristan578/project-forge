#!/usr/bin/env bash
# Contract test for scripts/post-deploy-capability-matrix-check.sh.
#
# WHY THIS SUITE EXISTS
#
# /capability-matrix on the docs site is rendered from a statically imported
# JSON copy of docs/capability-matrix.md (#9720). The first cut of that page
# read the copy with fs.readFileSync from a __dirname-derived path at request
# time — byte-for-byte the loader that 500'd /mcp in production for weeks
# while every local test stayed green (#9718): Next.js output file tracing
# ships only module edges, so the file never reached /var/task. No unit test
# can observe tracing; only the deployed artifact can. This probe is the gate
# that looks at the artifact, and a gate is very easy to write so that it
# passes on everything (lessons-learned #1: /api/health probed the CDN HOST
# while every versioned prefix 404'd).
#
# So the cases below are mostly REFUSALS: a 200 whose body is the page's own
# "no rows" notice, a 200 that mentions the marker row in prose but renders no
# table, a sign-in redirect, an empty body. The one accepting case is a body
# that carries the marker row rendered as a table cell.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
SCRIPT="$HERE/../post-deploy-capability-matrix-check.sh"
CD_YML="$REPO_ROOT/.github/workflows/cd.yml"
ARTIFACT_TEST="$REPO_ROOT/apps/docs/lib/__tests__/capabilityMatrixArtifact.test.ts"

PASS=0
FAIL=0
pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

[ -f "$SCRIPT" ] || { echo "script not found: $SCRIPT"; echo "SUITE FAILED"; exit 1; }

# Pull just the function under test out of the script, which otherwise runs a
# deploy probe on load. Extraction is asserted rather than assumed: a silently
# empty extraction would make every case below pass vacuously.
FN="$(awk '/^check_capability_matrix_body\(\) \{/{f=1} f{print} f&&/^\}$/{exit}' "$SCRIPT")"
if [ -z "$FN" ] || ! grep -q 'return 1' <<<"$FN"; then
  echo "  FAIL: could not extract check_capability_matrix_body from $SCRIPT — the tests below would pass vacuously"
  echo "SUITE FAILED"
  exit 1
fi

# The SSR output of CapabilityMatrixDocument for one matrix row: the row key is
# an inline-code node directly inside the row's first cell — a <th scope="row">,
# because the row key is what the row is ABOUT (WCAG 1.3.1) — the header cells
# carry scope="col", the scroll wrapper is a focusable named region (WCAG
# 2.1.1), and a status cell is a data-status badge. One line, as React emits it.
#
# THIS FIXTURE IS STILL HAND-WRITTEN, and a hand-written fixture pins whatever
# contract its author believed (lesson #14). The independent check is in
# apps/docs/components/__tests__/CapabilityMatrixDocument.test.tsx, which
# EXTRACTS the two greps out of the script above and replays them against the
# real renderToStaticMarkup output of the real document. If you change the
# markup, that test is what tells you — not this string.
TABLE_HTML='<h1>Capability Matrix</h1><h2>Command categories</h2><div role="region" aria-label="Command categories" tabindex="0" style="overflow-x:auto"><table><thead><tr><th scope="col" style="padding:0.5rem">Category</th><th scope="col">Human/UI</th><th scope="col">Notes</th></tr></thead><tbody><tr><th scope="row" style="padding:0.5rem"><code style="font-family:ui-monospace">commands:scene</code></th><td><span data-status="proven">proven</span></td><td>26/0. Hierarchy.</td></tr></tbody></table></div>'
# The page's explicit notice for a copy with no rows (page.tsx). This is what a
# reader sees when the artifact is broken; it is a 200.
NOTICE_HTML='<h1>Capability Matrix</h1><p role="alert" style="color:#fafafa">The capability matrix shipped with this deployment carries no rows. The canonical copy is at <a href="https://github.com/Tristan578/project-forge/blob/main/docs/capability-matrix.md">docs/capability-matrix.md</a>.</p>'
# The marker row named in prose only — a page that talks ABOUT the matrix
# without rendering it must not pass.
PROSE_HTML='<h1>Capability Matrix</h1><p>See the <code>commands:scene</code> row for spawn and inspect.</p>'

# run_with <http-code> <body> [expect-row] — run the extracted function.
run_with() {
  local code="$1" body="$2" expect="${3:-commands:scene}" tmp out rc
  tmp="$(mktemp -d)"
  printf '%s' "$body" > "$tmp/body.html"
  out="$(
    eval "$FN"
    MATRIX_CHECK_EXPECT_ROW="$expect" check_capability_matrix_body "$code" "$tmp/body.html" 2>&1
  )" && rc=0 || rc=$?
  rm -rf "$tmp"
  printf '%s\n---RC---%s' "$out" "$rc"
}

rc_of() { local r="${1#*---RC---}"; printf '%s' "$r"; }

echo "=== the body check must fail on everything but a rendered matrix row ==="

# --- the accepting case ---
RES="$(run_with 200 "$TABLE_HTML")"
if [ "$(rc_of "$RES")" = "0" ]; then
  pass "200 + the marker row rendered as a table cell passes"
else
  fail "the rendered matrix was rejected: $RES"
fi

RES="$(run_with 200 "${TABLE_HTML//commands:scene/commands:animation}" commands:animation)"
if [ "$(rc_of "$RES")" = "0" ]; then
  pass "MATRIX_CHECK_EXPECT_ROW selects the marker row"
else
  fail "an overridden marker row was rejected: $RES"
fi

# --- refusals ---
RES="$(run_with 200 "$NOTICE_HTML")"
if [ "$(rc_of "$RES")" != "0" ]; then
  pass "a 200 carrying the page's own 'no rows' notice fails (the #9718 shape, rendered)"
else
  fail "the no-rows notice passed — this IS the failure the probe exists to catch"
fi
if grep -q 'no rows' <<<"$RES"; then
  pass "the refusal says the page rendered its no-rows notice"
else
  fail "the refusal did not explain the notice: $RES"
fi

RES="$(run_with 200 "$PROSE_HTML")"
if [ "$(rc_of "$RES")" != "0" ]; then
  pass "a 200 that names the marker row in prose but renders no table fails"
else
  fail "prose mentioning the marker row passed as a rendered table"
fi

RES="$(run_with 200 "${TABLE_HTML//commands:scene/commands:audio}")"
if [ "$(rc_of "$RES")" != "0" ]; then
  pass "a rendered table WITHOUT the marker row fails"
else
  fail "a table missing the marker row passed"
fi

RES="$(run_with 200 '')"
if [ "$(rc_of "$RES")" != "0" ]; then
  pass "an empty 200 body fails closed"
else
  fail "an empty body passed"
fi

RES="$(run_with 307 '')"
if [ "$(rc_of "$RES")" != "0" ] && grep -q '307' <<<"$RES"; then
  pass "a 307 (the proxy's sign-in redirect for a route dropped from PUBLIC_ROUTES) fails and names the status"
else
  fail "a redirect did not fail closed with its status: $RES"
fi

RES="$(run_with 404 "$TABLE_HTML")"
if [ "$(rc_of "$RES")" != "0" ]; then
  pass "a 404 fails even when the body looks right (the route is not there)"
else
  fail "a 404 with a plausible body passed"
fi

RES="$(run_with 500 '<h1>Internal Server Error</h1>')"
if [ "$(rc_of "$RES")" != "0" ]; then
  pass "a 500 fails"
else
  fail "a 500 passed"
fi

RES="$(run_with 000 '')"
if [ "$(rc_of "$RES")" != "0" ]; then
  pass "an unreachable host (curl status 000) fails"
else
  fail "status 000 passed"
fi

# ---------------------------------------------------------------------------
# End-to-end: the whole script against a stubbed curl.
# ---------------------------------------------------------------------------
echo ""
echo "=== the whole check, against a stubbed curl ==="

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
cat > "$TMP/bin/curl" <<'EOF'
#!/usr/bin/env bash
out=""
printf '%s\n' "$@" > "$STUB_ARGS"
while [ $# -gt 0 ]; do
  case "$1" in
    --output) out="$2"; shift ;;
  esac
  shift
done
[ -n "$out" ] && cat "$STUB_BODY" > "$out"
printf '%s' "$STUB_STATUS"
# Real curl writes %{http_code} (000) to stdout AND exits non-zero on a
# connection/DNS/timeout error. The stub reproduces BOTH, because the exit
# status is the half the caller has to handle correctly.
exit "${STUB_EXIT:-0}"
EOF
chmod +x "$TMP/bin/curl"

# e2e <status> <body> — remaining env comes from the caller ($STUB_EXIT, $RETRIES,
# $URL, $VERCEL_AUTOMATION_BYPASS).
e2e() {
  local status="$1" body="$2"
  printf '%s' "$body" > "$TMP/body"
  : > "$TMP/args"
  (
    PATH="$TMP/bin:$PATH" STUB_STATUS="$status" STUB_BODY="$TMP/body" STUB_ARGS="$TMP/args" \
    STUB_EXIT="${STUB_EXIT:-0}" \
    MATRIX_RESPONSE_FILE="$TMP/resp.html" \
    MATRIX_CHECK_STABILIZE_S=0 MATRIX_CHECK_INTERVAL_S=0 MATRIX_CHECK_RETRIES="${RETRIES:-2}" \
    bash "$SCRIPT" "${URL:-https://docs.example.test/}" 2>&1
  )
}

OUT="$(e2e 200 "$TABLE_HTML")"; RC=$?
if [ "$RC" = 0 ] && grep -q 'Capability matrix check passed' <<<"$OUT"; then
  pass "200 + rendered row passes end to end"
else
  fail "the healthy case failed: rc=$RC $OUT"
fi
if grep -qx 'https://docs.example.test/capability-matrix' "$TMP/args"; then
  pass "the probe hits <base-url>/capability-matrix (trailing slash on the base stripped)"
else
  fail "the probe did not request /capability-matrix; args=$(tr '\n' ' ' < "$TMP/args")"
fi
if grep -qx -- '--max-time' "$TMP/args" && ! grep -qx -- '--location' "$TMP/args" && ! grep -qx -- '-L' "$TMP/args"; then
  pass "the request carries a timeout and does NOT follow redirects (a sign-in 307 must stay a 307)"
else
  fail "curl args wrong: $(tr '\n' ' ' < "$TMP/args")"
fi

OUT="$(VERCEL_AUTOMATION_BYPASS=s3cret e2e 200 "$TABLE_HTML")"; RC=$?
if [ "$RC" = 0 ] && grep -qx 'x-vercel-protection-bypass: s3cret' "$TMP/args"; then
  pass "a bypass secret is sent as the x-vercel-protection-bypass HEADER"
else
  fail "bypass header missing; args=$(tr '\n' ' ' < "$TMP/args")"
fi
if ! grep 'http' "$TMP/args" | grep -q 's3cret'; then
  pass "the bypass secret never appears in the URL"
else
  fail "the bypass secret was put into the query string, where it lands in logs"
fi

OUT="$(e2e 200 "$NOTICE_HTML")"; RC=$?
if [ "$RC" != 0 ] && grep -q 'failed after' <<<"$OUT"; then
  pass "the no-rows notice fails end to end after the retries"
else
  fail "the notice passed end to end: rc=$RC $OUT"
fi

OUT="$(e2e 307 '')"; RC=$?
if [ "$RC" != 0 ]; then
  pass "a sign-in redirect fails end to end"
else
  fail "a redirect passed end to end: $OUT"
fi

OUT="$(bash "$SCRIPT" 2>&1)"; RC=$?
if [ "$RC" != 0 ] && grep -q 'Usage' <<<"$OUT"; then
  pass "a missing base URL is a usage error, not a pass"
else
  fail "no base URL did not fail: rc=$RC $OUT"
fi

# --- an UNREACHABLE host: curl prints 000 AND exits non-zero ---
#
# The direct-function case above drives `check_capability_matrix_body 000`
# straight, so it can never see how the caller CAPTURES the code. This case
# does: with `$(curl ... || echo 000)` the substitution keeps curl's own 000
# and appends a second one, so the value is the two-line string "000\n000"
# and the only diagnostic the operator gets reads
# "answered HTTP 000\n000, not 200". The `||` has to be on the ASSIGNMENT.
OUT="$(STUB_EXIT=7 e2e 000 '')"; RC=$?
if [ "$RC" != 0 ]; then
  pass "an unreachable host (curl exits non-zero) fails end to end"
else
  fail "a failed curl passed end to end: $OUT"
fi
if grep -q 'answered HTTP 000, not 200' <<<"$OUT"; then
  pass "the diagnostic names a single HTTP 000, not curl's status appended to the fallback"
else
  fail "the captured status is not a single 000 — check the '||' is on the assignment: $OUT"
fi
if ! grep -qE '^0{3}(,|$)' <<<"$OUT"; then
  pass "no stray '000' line leaked out of the status capture"
else
  fail "the status capture produced a multi-line value: $OUT"
fi

# --- the marker row is stated in three places; pin them equal ---
#
# The top-level EXPECT_ROW feeds only the log lines; the function-local one
# gates the exit (a deliberate seam — extracting the function standalone under
# `set -u` would fail on an unbound $EXPECT_ROW). KNOWN_ROW in the docs
# artifact test is the third. Nothing compared them, and the only thing asking
# for them to move together was a prose comment.
mapfile -t MARKER_DEFAULTS < <(grep -oE 'MATRIX_CHECK_EXPECT_ROW:-[^}]+' "$SCRIPT" | sed 's/^MATRIX_CHECK_EXPECT_ROW:-//')
if [ "${#MARKER_DEFAULTS[@]}" = "2" ]; then
  pass "the script states the marker-row default at exactly the two known sites"
else
  fail "expected 2 MATRIX_CHECK_EXPECT_ROW defaults in $SCRIPT, found ${#MARKER_DEFAULTS[@]}"
fi
if [ "${#MARKER_DEFAULTS[@]}" -ge 2 ] && [ "${MARKER_DEFAULTS[0]}" = "${MARKER_DEFAULTS[1]}" ]; then
  pass "both marker-row defaults are byte-identical (${MARKER_DEFAULTS[0]})"
else
  fail "the marker-row defaults disagree: '${MARKER_DEFAULTS[0]:-}' vs '${MARKER_DEFAULTS[1]:-}' — the log lines would name a row the gate does not check"
fi
if [ -f "$ARTIFACT_TEST" ]; then
  KNOWN_ROW="$(grep -E '^const KNOWN_ROW' "$ARTIFACT_TEST" | sed "s/.*= *//; s/;\$//; s/^'//; s/'\$//" | tr -d '`')"
  if [ -n "$KNOWN_ROW" ]; then
    pass "read KNOWN_ROW out of the docs artifact test ($KNOWN_ROW)"
  else
    fail "could not read KNOWN_ROW from $ARTIFACT_TEST — the comparison below would be vacuous"
  fi
  if [ "$KNOWN_ROW" = "${MARKER_DEFAULTS[0]:-}" ]; then
    pass "the docs artifact test pins the same marker row the probe greps for"
  else
    fail "KNOWN_ROW ('$KNOWN_ROW') != the probe's marker row ('${MARKER_DEFAULTS[0]:-}') — rename both in the same commit"
  fi
else
  fail "artifact test not found at $ARTIFACT_TEST"
fi

# --- no fail-open path may survive ---
if [ "$(grep -cE '^[[:space:]]*exit 0([[:space:]]|$)' "$SCRIPT")" = "1" ]; then
  pass "exactly one 'exit 0' exists in the script — the success path"
else
  fail "the script has $(grep -cE '^[[:space:]]*exit 0([[:space:]]|$)' "$SCRIPT") 'exit 0' sites; a second one is a fail-open path"
fi
if awk '/for attempt/{f=1} f && /check_capability_matrix_body/{found=1} f && /exit 0/{exit} END{exit !found}' "$SCRIPT"; then
  pass "the body check gates the success exit inside the retry loop"
else
  fail "check_capability_matrix_body is not evaluated between the retry loop and 'exit 0' — a 200 would pass without it"
fi

# ---------------------------------------------------------------------------
# Wiring: the probe must run in cd.yml's docs deploy, AFTER the deploy step.
# A probe nobody calls is decorative (lesson #1's family: the check exists and
# the property it guards is never observed).
# ---------------------------------------------------------------------------
echo ""
echo "=== the probe is wired into the docs deploy ==="
if [ -f "$CD_YML" ]; then
  DOCS_JOB="$(awk '/^  deploy-docs:$/{f=1; print; next} f && /^  [a-z-]+:$/{exit} f{print}' "$CD_YML")"
  if [ -n "$DOCS_JOB" ] && grep -q 'vercel deploy --prod' <<<"$DOCS_JOB"; then
    pass "found the deploy-docs job with its vercel deploy step"
  else
    fail "could not isolate the deploy-docs job in cd.yml — the wiring checks below would be vacuous"
  fi
  if grep -q 'bash scripts/post-deploy-capability-matrix-check.sh' <<<"$DOCS_JOB"; then
    pass "deploy-docs runs post-deploy-capability-matrix-check.sh"
  else
    fail "deploy-docs does not run post-deploy-capability-matrix-check.sh"
  fi
  if awk '/vercel deploy --prod/{d=1} d && /post-deploy-capability-matrix-check\.sh/{found=1} END{exit !found}' <<<"$DOCS_JOB"; then
    pass "the probe step comes AFTER the vercel deploy step"
  else
    fail "the probe is not after the deploy step — it would probe the previous deployment"
  fi
  if grep -q 'https://docs.spawnforge.ai' <<<"$DOCS_JOB"; then
    pass "the probe targets the public docs domain"
  else
    fail "the probe does not target https://docs.spawnforge.ai"
  fi
  # The response-file seam is TEST-ONLY. Comment-stripped: a prose mention in a
  # workflow comment is not a wiring.
  if ! sed 's/#.*$//' "$REPO_ROOT"/.github/workflows/*.yml | grep -q 'MATRIX_RESPONSE_FILE'; then
    pass "no workflow sets the MATRIX_RESPONSE_FILE test seam"
  else
    fail "a workflow sets MATRIX_RESPONSE_FILE — the probe could be pointed at a canned body from CI config"
  fi
else
  fail "cd.yml not found at $CD_YML"
fi

echo ""
echo "  PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "SUITE PASSED"
  exit 0
fi
echo "SUITE FAILED"
exit 1
