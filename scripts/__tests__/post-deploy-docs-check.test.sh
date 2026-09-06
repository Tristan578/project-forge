#!/usr/bin/env bash
# Contract test for scripts/post-deploy-docs-check.sh and its cd.yml wiring.
#
# WHY THIS SUITE EXISTS
#
# docs.spawnforge.ai/mcp returned HTTP 500 in production for weeks with every
# check green (#9718). The manifest loader read a file that output file
# tracing never shipped, the unit test had mocked the filesystem, and the docs
# deploy job ended at `vercel deploy --prod` with no probe of the artifact it
# had just published. Nothing in the pipeline ever asked the live page a
# question.
#
# This gate asks three. `/mcp` must be 200 AND list a category tile — the page
# renders "No public commands available yet" with a 200 when the manifest is
# empty, so status alone is lesson 1's "adjacent property". `/mcp/<category>`
# must be 200 AND name a known command. And every accepted page must carry the
# commit stamp of THIS deploy: a healthy body proves that SOMETHING is healthy,
# only the stamp proves it is the build this run published and not the
# previous one still behind the alias.
#
# Most cases below are REFUSAL cases, and the whole script runs against a
# stubbed `curl` so the suite needs no network.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../post-deploy-docs-check.sh"
CD_YML="$HERE/../../.github/workflows/cd.yml"
WORKFLOW_DIR="$HERE/../../.github/workflows"
ARTIFACT_TEST="$HERE/../../apps/docs/lib/__tests__/commandsManifestArtifact.test.ts"
COMMIT_MODULE="$HERE/../../apps/docs/lib/commit.ts"

PASS=0
FAIL=0
pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

[ -f "$SCRIPT" ] || { echo "  FAIL: script not found: $SCRIPT"; echo "SUITE FAILED"; exit 1; }
[ -f "$CD_YML" ] || { echo "  FAIL: workflow not found: $CD_YML"; echo "SUITE FAILED"; exit 1; }

# The width the gate compares commits on, extracted ONCE. Several cases below
# build their fixtures from it rather than restating 8, so raising the constant
# moves the cases with it instead of leaving them testing a width the script no
# longer uses. A failed extraction is fatal here, not a silent 0: every derived
# case would otherwise run against an empty width and pass vacuously (lesson 11).
SCRIPT_WIDTH="$(sed -nE 's/^COMMIT_COMPARE_WIDTH=([0-9]+)$/\1/p' "$SCRIPT" | head -1)"
case "$SCRIPT_WIDTH" in
  ''|*[!0-9]*)
    echo "  FAIL: could not extract COMMIT_COMPARE_WIDTH from $SCRIPT (got '$SCRIPT_WIDTH') — every case derived from it would be vacuous"
    echo "SUITE FAILED"; exit 1 ;;
esac

# ---------------------------------------------------------------------------
# The whole script against a stubbed curl.
#
# The stub records its argv, picks a fixture by the URL it was asked for
# (`.../mcp` -> index, anything under `.../mcp/` -> category), writes that
# fixture's body to --output and prints its status for -w.
#
# The stub is STATEFUL: it counts hits per route in $STUB_DIR/<route>.hits and,
# when `<route>.<n>.status` exists for hit number n, answers from that instead
# of the default `<route>.status`. That is what lets the suite prove a
# transient failure followed by a healthy answer PASSES — a stateless stub can
# only show that a persistent failure is retried, never that a success on
# attempt >= 2 is honoured.
# ---------------------------------------------------------------------------
echo "=== the whole check, against a stubbed curl ==="

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
cat > "$TMP/bin/curl" <<'EOF'
#!/usr/bin/env bash
out=""; url=""
printf '%s\n' "$@" >> "$STUB_ARGS"
while [ $# -gt 0 ]; do
  case "$1" in
    --output) out="$2"; shift ;;
    http://*|https://*) url="$1" ;;
  esac
  shift
done
case "$url" in
  */mcp) which=index ;;
  */mcp/*) which=category ;;
  *) which=other ;;
esac
n=0
[ -f "$STUB_DIR/$which.hits" ] && n="$(cat "$STUB_DIR/$which.hits")"
n=$((n + 1))
printf '%s' "$n" > "$STUB_DIR/$which.hits"
pick="$which"
[ -f "$STUB_DIR/$which.$n.status" ] && pick="$which.$n"
[ -n "$out" ] && cat "$STUB_DIR/$pick.body" > "$out"
cat "$STUB_DIR/$pick.status"
EOF
chmod +x "$TMP/bin/curl"

# The commit this "run" deployed, and one it did not. The layout stamps
# VERCEL_GIT_COMMIT_SHA into every page as this meta tag (apps/docs/lib/commit.ts).
DEPLOYED_SHA='abcdef1234567890abcdef1234567890abcdef12'
OTHER_SHA='0123456789abcdef0123456789abcdef01234567'
stamp() { printf '<head><meta name="spawnforge-docs-commit" content="%s"/></head>' "$1"; }

# The shapes the live pages render. A category tile is the ONLY thing `/mcp`
# emits when publicCount > 0 that it does not emit when publicCount == 0.
INDEX_TILES='<main><p>282 public commands across 35 categories.</p><ul><li><a href="/mcp/scene">scene</a></li><li><a href="/mcp/camera">camera</a></li></ul></main>'
INDEX_OK="<html>$(stamp "$DEPLOYED_SHA")<body>${INDEX_TILES}</body></html>"
INDEX_OTHER_BUILD="<html>$(stamp "$OTHER_SHA")<body>${INDEX_TILES}</body></html>"
INDEX_UNSTAMPED="<html><head></head><body>${INDEX_TILES}</body></html>"
INDEX_EMPTY="<html>$(stamp "$DEPLOYED_SHA")<body><main><p>No public commands available yet. Commands are being reviewed for public documentation.</p></main></body></html>"
CATEGORY_LIST='<main><h1>scene</h1><p>12 public commands in this category.</p><ul><li id="spawn_entity"><h2>spawn_entity</h2></li><li id="despawn_entity"><h2>despawn_entity</h2></li></ul></main>'
CATEGORY_OK="<html>$(stamp "$DEPLOYED_SHA")<body>${CATEGORY_LIST}</body></html>"
CATEGORY_OTHER_BUILD="<html>$(stamp "$OTHER_SHA")<body>${CATEGORY_LIST}</body></html>"
CATEGORY_EMPTY="<html>$(stamp "$DEPLOYED_SHA")<body><main><h1>scene</h1><p>0 public commands in this category.</p><ul></ul></main></body></html>"
SERVER_ERROR='Internal Server Error'
NOT_FOUND='<html><body>404: This page could not be found.</body></html>'

# e2e <index-status> <index-body> <category-status> <category-body>
#
# Optional overrides via the environment:
#   URL                 base URL passed to the script
#   RETRIES             DOCS_CHECK_RETRIES (default 2)
#   EXPECT_COMMIT       DOCS_CHECK_EXPECT_COMMIT (default: the deployed SHA;
#                       set it to the empty string to run with it unset)
#   FIRST_INDEX_STATUS  answer for the FIRST /mcp hit only; later hits fall
#   FIRST_INDEX_BODY    through to <index-status>/<index-body>
e2e() {
  printf '%s' "$1" > "$TMP/index.status"
  printf '%s' "$2" > "$TMP/index.body"
  printf '%s' "$3" > "$TMP/category.status"
  printf '%s' "$4" > "$TMP/category.body"
  printf '%s' "500" > "$TMP/other.status"
  printf '%s' "unexpected url" > "$TMP/other.body"
  rm -f "$TMP"/*.hits "$TMP"/*.[0-9].status "$TMP"/*.[0-9].body
  if [ -n "${FIRST_INDEX_STATUS:-}" ]; then
    printf '%s' "$FIRST_INDEX_STATUS" > "$TMP/index.1.status"
    printf '%s' "${FIRST_INDEX_BODY:-}" > "$TMP/index.1.body"
  fi
  : > "$TMP/args"
  (
    PATH="$TMP/bin:$PATH" STUB_DIR="$TMP" STUB_ARGS="$TMP/args" \
    DOCS_RESPONSE_FILE="$TMP/resp.html" \
    DOCS_CHECK_EXPECT_COMMIT="${EXPECT_COMMIT-$DEPLOYED_SHA}" \
    DOCS_CHECK_STABILIZE_S=0 DOCS_CHECK_INTERVAL_S=0 DOCS_CHECK_RETRIES="${RETRIES:-2}" \
    bash "$SCRIPT" "${URL:-https://docs.example.test}" 2>&1
  )
}
index_hits() { grep -cx 'https://docs.example.test/mcp' "$TMP/args" || true; }
category_hits() { grep -cx 'https://docs.example.test/mcp/scene' "$TMP/args" || true; }

# --- refusal: no target ---
OUT="$(DOCS_CHECK_EXPECT_COMMIT="$DEPLOYED_SHA" bash "$SCRIPT" 2>&1)"; RC=$?
if [ "$RC" != 0 ] && grep -q 'Usage' <<<"$OUT"; then
  pass "no base URL is a usage error, not a vacuous pass"
else
  fail "missing argument did not fail with usage (rc=$RC): $OUT"
fi

# --- refusal: no expected commit ---
# Without an expected commit the gate can only prove that SOME build is
# healthy. That is the property the health-check learned not to trust
# (post-deploy-health-check.sh check_commit_identity), so here it is required.
OUT="$(EXPECT_COMMIT='' e2e 200 "$INDEX_OK" 200 "$CATEGORY_OK")"; RC=$?
if [ "$RC" != 0 ] && grep -q 'DOCS_CHECK_EXPECT_COMMIT' <<<"$OUT" && [ "$(index_hits)" = "0" ]; then
  pass "an unset DOCS_CHECK_EXPECT_COMMIT fails before any probe and names the variable"
else
  fail "the gate ran without an expected commit (rc=$RC, index hits=$(index_hits)): $OUT"
fi

OUT="$(EXPECT_COMMIT=unknown e2e 200 "$INDEX_OK" 200 "$CATEGORY_OK")"; RC=$?
if [ "$RC" != 0 ] && grep -q 'DOCS_CHECK_EXPECT_COMMIT' <<<"$OUT" && [ "$(index_hits)" = "0" ]; then
  pass "a non-hex DOCS_CHECK_EXPECT_COMMIT is refused up front (the page stamps 'unknown' when it has no SHA — that must never compare equal)"
else
  fail "a non-hex expected commit was accepted (rc=$RC): $OUT"
fi

# --- accepting ---
OUT="$(e2e 200 "$INDEX_OK" 200 "$CATEGORY_OK")"; RC=$?
if [ "$RC" = 0 ]; then
  pass "200 + a category tile on /mcp, 200 + the known command on /mcp/scene, both stamped with this deploy's commit: passes end to end"
else
  fail "the healthy case failed: $OUT"
fi
if grep -qx 'https://docs.example.test/mcp' "$TMP/args" && grep -qx 'https://docs.example.test/mcp/scene' "$TMP/args"; then
  pass "both /mcp and /mcp/scene were requested on the base URL given"
else
  fail "expected both routes to be probed; curl saw: $(tr '\n' ' ' < "$TMP/args")"
fi
if grep -q 'max-time' "$TMP/args" && ! grep -qE '^(-L|--location)$' "$TMP/args"; then
  pass "requests carry a timeout and do not follow redirects (a 3xx is not a 200)"
else
  fail "curl argv lacks --max-time or follows redirects: $(tr '\n' ' ' < "$TMP/args")"
fi

OUT="$(URL=https://docs.example.test/ e2e 200 "$INDEX_OK" 200 "$CATEGORY_OK")"; RC=$?
if [ "$RC" = 0 ] && grep -qx 'https://docs.example.test/mcp' "$TMP/args"; then
  pass "a trailing slash on the base URL is normalised (no //mcp)"
else
  fail "trailing-slash base URL produced a bad route: $(tr '\n' ' ' < "$TMP/args") $OUT"
fi

OUT="$(DOCS_CHECK_CATEGORY=camera DOCS_CHECK_COMMAND=zoom_camera e2e 200 "$INDEX_OK" 200 "$(stamp "$DEPLOYED_SHA")<h2>zoom_camera</h2>")"; RC=$?
if [ "$RC" = 0 ] && grep -qx 'https://docs.example.test/mcp/camera' "$TMP/args"; then
  pass "DOCS_CHECK_CATEGORY / DOCS_CHECK_COMMAND select the category page and the name looked for"
else
  fail "category/command overrides were not honoured: $(tr '\n' ' ' < "$TMP/args") $OUT"
fi

OUT="$(EXPECT_COMMIT="${DEPLOYED_SHA:0:$SCRIPT_WIDTH}" e2e 200 "$INDEX_OK" 200 "$CATEGORY_OK")"; RC=$?
if [ "$RC" = 0 ]; then
  pass "the commit is compared on its first $SCRIPT_WIDTH chars — COMMIT_COMPARE_WIDTH (an abbreviated expected SHA matches a full stamp)"
else
  fail "a $SCRIPT_WIDTH-char expected commit was rejected against a matching full stamp: $OUT"
fi

# The caller-side validation minimum must FOLLOW COMMIT_COMPARE_WIDTH, not
# restate it. Hardcoded, raising the constant to 12 leaves an 8-char
# expectation accepted at validation and then compared against 12 reported
# chars — every attempt fails with the "DIFFERENT build" diagnosis on the very
# build under test. That is the same false mismatch the stamp-width cross-pin
# below removes on the other side, reintroduced on the expectation side.
TOO_SHORT="$(printf '%s' "$DEPLOYED_SHA" | cut -c "1-$((SCRIPT_WIDTH - 1))")"
OUT="$(EXPECT_COMMIT="$TOO_SHORT" e2e 200 "$INDEX_OK" 200 "$CATEGORY_OK")"; RC=$?
if [ "$RC" != 0 ] && grep -q 'DOCS_CHECK_EXPECT_COMMIT' <<<"$OUT" && [ "$(index_hits)" = "0" ]; then
  pass "an expected commit one char shorter than COMMIT_COMPARE_WIDTH ($SCRIPT_WIDTH) is refused before any probe"
else
  fail "a ${#TOO_SHORT}-char expected commit was accepted against a $SCRIPT_WIDTH-char comparison (rc=$RC, index hits=$(index_hits)): $OUT"
fi

# Git SHAs are conventionally lower-case, but nothing forces a caller to pass
# one that way: `DOCS_CHECK_EXPECT_COMMIT` is validated as [0-9a-fA-F]{8,40},
# so an upper-case SHA is ACCEPTED at validation and then, under a
# case-sensitive comparison, fails every attempt against a lower-case stamp
# with the "DIFFERENT build" diagnosis — the same commit reported as a
# different one, and the operator sent chasing alias lag that is not there.
UPPER_SHA="$(printf '%s' "$DEPLOYED_SHA" | tr 'a-f' 'A-F')"
OUT="$(EXPECT_COMMIT="$UPPER_SHA" e2e 200 "$INDEX_OK" 200 "$CATEGORY_OK")"; RC=$?
if [ "$RC" = 0 ]; then
  pass "an UPPER-case expected commit matches a lower-case stamp of the same SHA (the comparison is case-insensitive)"
else
  fail "an upper-case expected commit was rejected against a stamp of the same SHA (rc=$RC): $OUT"
fi

# The other direction: an upper-case stamp against the lower-case SHA cd.yml
# passes. Both sides must be folded, not just the one the caller controls.
INDEX_UPPER_STAMP="<html>$(stamp "$UPPER_SHA")<body>${INDEX_TILES}</body></html>"
CATEGORY_UPPER_STAMP="<html>$(stamp "$UPPER_SHA")<body>${CATEGORY_LIST}</body></html>"
OUT="$(e2e 200 "$INDEX_UPPER_STAMP" 200 "$CATEGORY_UPPER_STAMP")"; RC=$?
if [ "$RC" = 0 ]; then
  pass "an UPPER-case stamp matches the lower-case expected commit (both sides are folded, not just the caller's)"
else
  fail "an upper-case stamp was rejected against the same SHA lower-cased (rc=$RC): $OUT"
fi

# Case folding must not become "compare nothing": a genuinely different build
# still fails when the cases differ.
OUT="$(EXPECT_COMMIT="$UPPER_SHA" e2e 200 "$INDEX_OTHER_BUILD" 200 "$CATEGORY_OK")"; RC=$?
if [ "$RC" != 0 ] && grep -qi 'different build' <<<"$OUT"; then
  pass "case folding did not weaken the check — a genuinely different commit still fails against an upper-case expectation"
else
  fail "an upper-case expectation accepted a page from another build (rc=$RC): $OUT"
fi

# --- refusals ---
# The exact shape of #9718: the index route 500s.
OUT="$(e2e 500 "$SERVER_ERROR" 200 "$CATEGORY_OK")"; RC=$?
if [ "$RC" != 0 ] && grep -q '500' <<<"$OUT"; then
  pass "a 500 on /mcp fails the deploy and reports the status (#9718's exact shape)"
else
  fail "a 500 on /mcp was accepted (rc=$RC): $OUT"
fi

# Lesson 1: a 200 that renders zero commands is not a pass. This is what the
# page shows when the manifest is present but empty, or filtered to nothing.
OUT="$(e2e 200 "$INDEX_EMPTY" 200 "$CATEGORY_OK")"; RC=$?
if [ "$RC" != 0 ] && grep -qi 'no category\|empty\|zero' <<<"$OUT"; then
  pass "a 200 on /mcp with no category tile fails — an empty command list is not healthy"
else
  fail "an empty /mcp was accepted on its 200 alone (rc=$RC): $OUT"
fi

OUT="$(e2e 200 "$INDEX_OK" 404 "$NOT_FOUND")"; RC=$?
if [ "$RC" != 0 ] && grep -q '404' <<<"$OUT"; then
  pass "a 404 on /mcp/scene fails even though /mcp was healthy (the tiles must resolve, #9046)"
else
  fail "a 404 category page was accepted (rc=$RC): $OUT"
fi

OUT="$(e2e 200 "$INDEX_OK" 200 "$CATEGORY_EMPTY")"; RC=$?
if [ "$RC" != 0 ] && grep -q 'spawn_entity' <<<"$OUT"; then
  pass "a 200 on /mcp/scene that does not name spawn_entity fails and says which name it looked for"
else
  fail "a category page without the known command was accepted (rc=$RC): $OUT"
fi

# A description could mention the name; only the rendered heading counts.
OUT="$(e2e 200 "$INDEX_OK" 200 "$(stamp "$DEPLOYED_SHA")<p>Unlike spawn_entity, this one is different.</p>")"; RC=$?
if [ "$RC" != 0 ]; then
  pass "the command name is matched as a rendered heading, not as a substring anywhere in the body"
else
  fail "a prose mention of the command name satisfied the category check: $OUT"
fi

OUT="$(e2e 200 "$INDEX_OK" 200 "")"; RC=$?
if [ "$RC" != 0 ]; then
  pass "an empty 200 body on the category page fails"
else
  fail "an empty body was accepted: $OUT"
fi

# --- commit identity (lesson 1, as post-deploy-health-check.sh learned it) ---
# The alias can keep serving the PREVIOUS healthy build — alias assignment lag,
# or a --prod deploy whose domain set did not include docs.spawnforge.ai — and
# a content-only gate goes green against the old artifact.
OUT="$(e2e 200 "$INDEX_OTHER_BUILD" 200 "$CATEGORY_OK")"; RC=$?
if [ "$RC" != 0 ] && grep -q 'abcdef12' <<<"$OUT" && grep -q '01234567' <<<"$OUT" && grep -qi 'different build' <<<"$OUT"; then
  pass "a healthy 200 stamped with a DIFFERENT commit fails and names both commits (the alias is not serving this deploy)"
else
  fail "a healthy page from another build was accepted or not explained (rc=$RC): $OUT"
fi

# An unstamped page has one likely cause that no amount of retrying fixes:
# `VERCEL_GIT_COMMIT_SHA` only reaches the build when the Vercel project has
# "Automatically expose System Environment Variables" enabled, and that is a
# per-project dashboard toggle nothing in this repo can set. If the message
# does not name it, every docs deploy after this gate lands fails closed on a
# diagnosis that reads like alias lag, and the one action that fixes it is
# nowhere in the log.
OUT="$(e2e 200 "$INDEX_UNSTAMPED" 200 "$CATEGORY_OK")"; RC=$?
if [ "$RC" != 0 ] && grep -q 'reported no commit' <<<"$OUT" \
  && grep -q 'VERCEL_GIT_COMMIT_SHA' <<<"$OUT" \
  && grep -qi 'Automatically expose System Environment Variables' <<<"$OUT"; then
  pass "a healthy 200 with no commit stamp fails and names the toggle that produces it (Automatically expose System Environment Variables)"
else
  fail "an unstamped page passed the commit assertion, or failed without naming the toggle (rc=$RC): $OUT"
fi

# The SAME failure in the shape it is actually served — and the shape the case
# above cannot reach. A page with no <meta> at all returns early at
# `[ -n "$tag" ] || return 0` and never reaches the hex filter in
# commit_of_body, so it proves nothing about how a NON-HEX stamp is classified.
# But `commitStampOf()` (apps/docs/lib/commit.ts) renders UNKNOWN_COMMIT INTO
# the tag: a build with no VERCEL_GIT_COMMIT_SHA ships `content="unknown"`, tag
# present. That is the gate's PRIMARY documented failure mode — the toggle-off
# deploy — and the hex filter is the only thing that reads it as "no commit".
#
# Mutation-proven: relax that filter to `content="[^"]+"` and the unstamped
# case above stays green while an `unknown`-stamped page is diagnosed as "the
# alias is serving a DIFFERENT build" — the exact misdiagnosis the script
# header, apps/docs/README.md, docs/production-support.md section 13 and the
# changeset all promise will not happen. Hence the negative assertion: naming
# the toggle is not enough if the message ALSO blames another build.
for bad_stamp in unknown deadbeef-not-hex; do
  BAD_STAMP_INDEX="<html>$(stamp "$bad_stamp")<body>${INDEX_TILES}</body></html>"
  OUT="$(e2e 200 "$BAD_STAMP_INDEX" 200 "$CATEGORY_OK")"; RC=$?
  if [ "$RC" != 0 ] && grep -q 'reported no commit' <<<"$OUT" \
    && grep -q 'VERCEL_GIT_COMMIT_SHA' <<<"$OUT" \
    && grep -qi 'Automatically expose System Environment Variables' <<<"$OUT" \
    && ! grep -qi 'different build' <<<"$OUT"; then
    pass "a page stamped content=\"$bad_stamp\" reads as NO commit and names the toggle — never as another build"
  else
    fail "content=\"$bad_stamp\" was accepted, or was diagnosed as a different build instead of a missing commit (rc=$RC): $OUT"
  fi
done

# And the same non-hex stamp on the category page: both routes run the same
# classifier, but only a case proves the second one still does.
CATEGORY_UNKNOWN_STAMP="<html>$(stamp unknown)<body>${CATEGORY_LIST}</body></html>"
OUT="$(e2e 200 "$INDEX_OK" 200 "$CATEGORY_UNKNOWN_STAMP")"; RC=$?
if [ "$RC" != 0 ] && grep -q 'reported no commit' <<<"$OUT" && ! grep -qi 'different build' <<<"$OUT"; then
  pass "an 'unknown' stamp on the category page fails the same way behind a healthy index"
else
  fail "an 'unknown'-stamped category page was accepted or misdiagnosed (rc=$RC): $OUT"
fi

OUT="$(e2e 200 "$INDEX_OK" 200 "$CATEGORY_OTHER_BUILD")"; RC=$?
if [ "$RC" != 0 ] && grep -qi 'different build' <<<"$OUT"; then
  pass "the category page is held to the same commit as the index page"
else
  fail "a category page from another build was accepted behind a healthy index (rc=$RC): $OUT"
fi

# Alias lag resolves within seconds; a mismatch on attempt 1 must be RETRIED,
# not failed outright — and a persistent mismatch must still fail.
OUT="$(RETRIES=3 e2e 200 "$INDEX_OTHER_BUILD" 200 "$CATEGORY_OK")"; RC=$?
if [ "$RC" != 0 ] && [ "$(index_hits)" = "3" ]; then
  pass "a persistent commit mismatch is retried DOCS_CHECK_RETRIES times (alias lag is transient) and then fails"
else
  fail "expected 3 attempts on /mcp for a persistent mismatch, saw $(index_hits) (rc=$RC): $OUT"
fi

OUT="$(RETRIES=3 FIRST_INDEX_STATUS=200 FIRST_INDEX_BODY="$INDEX_OTHER_BUILD" e2e 200 "$INDEX_OK" 200 "$CATEGORY_OK")"; RC=$?
if [ "$RC" = 0 ] && [ "$(index_hits)" = "2" ]; then
  pass "the old build on attempt 1, this build on attempt 2: passes with exactly 2 index hits (alias lag tolerated within the retry budget)"
else
  fail "a stale-then-current alias did not pass on the second attempt (rc=$RC, index hits=$(index_hits)): $OUT"
fi

# Deployment Protection answering the probe means the check cannot observe the
# site. That is a failure, not a skip (#9624's lesson, applied here). The
# script is only ever pointed at the production ALIAS, so the diagnosis must
# name alias-side causes (firewall / Protect Production), not the deployment
# URL's SSO the operator is not using.
for code in 401 403; do
  OUT="$(e2e "$code" 'Authentication Required' 200 "$CATEGORY_OK")"; RC=$?
  if [ "$RC" != 0 ] && grep -qi 'cannot be observed\|protection' <<<"$OUT" && grep -qi 'firewall\|protect production' <<<"$OUT"; then
    pass "a $code fails closed, says the page could not be observed, and names the alias-side causes"
  else
    fail "a $code did not fail closed with an alias-side diagnosis (rc=$RC): $OUT"
  fi
done

# --- retries ---
# A persistent non-200 is retried DOCS_CHECK_RETRIES times; every attempt hits
# the index route before the category route is ever tried.
OUT="$(RETRIES=3 e2e 503 'Service Unavailable' 200 "$CATEGORY_OK")"; RC=$?
if [ "$RC" != 0 ] && [ "$(index_hits)" = "3" ] && [ "$(category_hits)" = "0" ]; then
  pass "a persistent non-200 is retried DOCS_CHECK_RETRIES times before failing (saw $(index_hits) attempts, category never tried)"
else
  fail "expected 3 attempts on /mcp and none on /mcp/scene, saw $(index_hits)/$(category_hits) (rc=$RC): $OUT"
fi

# The other half: a transient failure followed by a healthy answer PASSES. A
# regression that keeps looping but no longer honours a success on attempt
# >= 2 (or judges a stale response file from attempt 1) is invisible to the
# count assertion above.
OUT="$(RETRIES=3 FIRST_INDEX_STATUS=503 FIRST_INDEX_BODY='Service Unavailable' e2e 200 "$INDEX_OK" 200 "$CATEGORY_OK")"; RC=$?
if [ "$RC" = 0 ] && [ "$(index_hits)" = "2" ] && [ "$(category_hits)" = "1" ]; then
  pass "503 then 200 + tile: passes with exactly 2 index hits and 1 category hit (a success on attempt 2 is honoured)"
else
  fail "a transient 503 followed by a healthy 200 did not pass on the second attempt (rc=$RC, hits index=$(index_hits) category=$(category_hits)): $OUT"
fi

# ---------------------------------------------------------------------------
# Structural pins on the script.
# ---------------------------------------------------------------------------
echo ""
echo "=== the script has no fail-open path ==="

EXIT0_COUNT="$(grep -cE '^[[:space:]]*exit 0([[:space:]]|$)' "$SCRIPT" || true)"
if [ "$EXIT0_COUNT" = "1" ]; then
  pass "exactly one 'exit 0' exists in the script — the success path"
else
  fail "the script has $EXIT0_COUNT 'exit 0' sites; a second one is a fail-open path"
fi

if grep -qE '^set -euo pipefail' "$SCRIPT"; then
  pass "the script runs under set -euo pipefail"
else
  fail "the script does not set -euo pipefail — an unset variable or a failed pipeline could pass silently"
fi

# ---------------------------------------------------------------------------
# bash 3.2 portability.
#
# macOS still ships bash 3.2 as /bin/bash, which is what `#!/usr/bin/env bash`
# resolves to on a stock machine, and this repo treats 3.2 as the floor for its
# CI self-defense scripts: scripts/check-skills.sh ("bash 3.2, no mapfile/
# associative arrays"), scripts/check-changeset-packages.sh, the
# `${ARR[@]+...}` read guards in scripts/check-npm-audit.sh, and the fixture
# seam in scripts/__tests__/db-migration-guard.test.sh all say so in as many
# words. The portable case-fold used elsewhere is `tr '[:upper:]' '[:lower:]'`
# (.claude/hooks/block-deferred-fixes.sh).
#
# A bash-4-only construct is not a degraded run: the `,,` case-fold expansion
# is a PARSE error on 3.2 — the script dies with `bad substitution` before the
# first probe (this comment spells it without the sigil on purpose, because the
# scan below reads this file too), and every diagnosis it was written to
# produce is replaced by an unactionable shell error. shellcheck does not diagnose bash-4 syntax under a bash shebang,
# so nothing else in CI sees it — hence this pin. It covers this suite too: a
# suite that cannot parse on 3.2 reports nothing about the script.
# ---------------------------------------------------------------------------
echo ""
echo "=== the script and this suite parse on bash 3.2 ==="

# Case-modification expansions (a comma or caret immediately after the name
# inside a parameter expansion — the lower/upper folds), mapfile/readarray, and
# associative-array declarations: all bash 4.0. The last two are anchored at
# command position, and none of them is spelled literally in this file's prose,
# so the scan does not match itself.
BASH4_ONLY_RE='\$\{[A-Za-z_][A-Za-z0-9_]*(\[[^]]*\])?(\^|,)|^[[:space:]]*(mapfile|readarray)[[:space:]]|^[[:space:]]*(declare|local|typeset)[[:space:]]+-[A-Za-z]*A([[:space:]]|$)'

# bash4_hits <file>: prints `<line>:<text>` for each bash-4-only construct.
# Returns 2 when the file cannot be read, so a mistyped path fails closed
# instead of reading as "clean".
bash4_hits() {
  [ -f "$1" ] || { printf 'unreadable: %s\n' "$1"; return 2; }
  grep -nE "$BASH4_ONLY_RE" "$1" || true
  return 0
}

# Self-test: the detector can fire, and does not fire on the portable idioms
# this script legitimately uses. A scan that can only return "clean" is not a
# gate (lesson 11). The bad fixtures are written via printf so this file's own
# source never contains the spelling it is scanning for.
B4_FIX="$TMP/bash4"
mkdir -p "$B4_FIX"
printf 'x="%s{SOME_VAR,,}"\n' '$' > "$B4_FIX/fold.sh"
printf 'y="%s{SOME_VAR^^}"\n' '$' > "$B4_FIX/upper.sh"
printf 'declare -A lookup\n' > "$B4_FIX/assoc.sh"
# shellcheck disable=SC2016  # these are fixture TEXT, not expressions to expand
printf '%s\n' \
  'lower="$(printf "%s" "$raw" | tr "[:upper:]" "[:lower:]")"' \
  'short="${lower:0:8}"' \
  'copy=("${args[@]}")' \
  'local plain=1' > "$B4_FIX/clean.sh"

B4_SELF_FAIL=0
for f in fold upper assoc; do
  if [ -n "$(bash4_hits "$B4_FIX/$f.sh")" ]; then
    pass "the bash-4 detector fires on $f.sh"
  else
    fail "the bash-4 detector missed $f.sh — the real scan below cannot fail"
    B4_SELF_FAIL=1
  fi
done
if [ -z "$(bash4_hits "$B4_FIX/clean.sh")" ]; then
  pass "the bash-4 detector stays silent on the portable idioms (tr fold, \${v:0:n}, \"\${arr[@]}\", plain local)"
else
  fail "the bash-4 detector flags portable 3.2 syntax: $(bash4_hits "$B4_FIX/clean.sh")"
  B4_SELF_FAIL=1
fi
bash4_hits "$B4_FIX/does-not-exist.sh" > /dev/null; B4_RC=$?
if [ "$B4_RC" = 2 ]; then
  pass "the bash-4 detector fails closed on an unreadable file"
else
  fail "the bash-4 detector returned $B4_RC for a missing file — a mistyped path would read as clean"
  B4_SELF_FAIL=1
fi

if [ "$B4_SELF_FAIL" != 0 ]; then
  fail "the bash-4 detector self-test failed, so the real scan below proves nothing"
else
  for target in "$SCRIPT" "${BASH_SOURCE[0]}"; do
    B4_OUT="$(bash4_hits "$target")"; B4_RC=$?
    if [ "$B4_RC" != 0 ]; then
      fail "could not scan $target for bash-4-only syntax (rc=$B4_RC): $B4_OUT"
    elif [ -z "$B4_OUT" ]; then
      pass "$(basename "$target") uses no bash-4-only syntax (bash 3.2 parses it)"
    else
      fail "$(basename "$target") uses bash-4-only syntax — bash 3.2 dies with 'bad substitution' before the first probe. Use tr '[:upper:]' '[:lower:]' to fold case. Hits: $B4_OUT"
    fi
  done
fi

# ---------------------------------------------------------------------------
# COMMIT_COMPARE_WIDTH is the single source of the comparison width, so every
# OTHER width in the script must be derived from it rather than restate it.
# The runtime case above proves the caller-side minimum tracks the constant;
# these two prove it does so by derivation and not by coincidence, and that the
# header prose points at the constant instead of naming a number that will rot.
# ---------------------------------------------------------------------------
HARDCODED_QUANT="$(grep -nE '\{[0-9]+,[0-9]+\}' "$SCRIPT" || true)"
if [ -z "$HARDCODED_QUANT" ]; then
  pass "no hardcoded {min,max} length quantifier survives in the script"
else
  fail "the script hardcodes a length quantifier that COMMIT_COMPARE_WIDTH should supply: $HARDCODED_QUANT"
fi

# shellcheck disable=SC2016  # the literal $EXPECT_COMMIT_RE IS the text being pinned
if grep -qE '^EXPECT_COMMIT_RE=.*COMMIT_COMPARE_WIDTH' "$SCRIPT" \
  && grep -qE '=~ \$EXPECT_COMMIT_RE' "$SCRIPT"; then
  pass "DOCS_CHECK_EXPECT_COMMIT is validated against a pattern built from COMMIT_COMPARE_WIDTH"
else
  fail "the caller-side validation does not derive its minimum from COMMIT_COMPARE_WIDTH — raising the constant would leave a shorter expectation accepted and then reported as a DIFFERENT build"
fi

SCRIPT_HEADER="$(sed -n '1,/^set -euo pipefail/p' "$SCRIPT")"
if grep -q 'COMMIT_COMPARE_WIDTH' <<<"$SCRIPT_HEADER"; then
  pass "the header prose names COMMIT_COMPARE_WIDTH rather than restating its value"
else
  fail "the header prose does not name COMMIT_COMPARE_WIDTH — a number written out there rots the moment the constant changes"
fi

# ---------------------------------------------------------------------------
# Cross-file pins. Three files hardcode the same values independently and
# nothing else asserts they agree; a rename that updates one of them passes
# CI and goes red only at CD, after the deploy has already happened.
#   - the known category/command pair: the script's defaults vs the constants
#     in commandsManifestArtifact.test.ts (which proves the pair is in the
#     manifest the site ships)
#   - the commit meta name: the script's grep target vs the name the layout
#     renders (apps/docs/lib/commit.ts)
# Every extraction must be non-empty — an empty pair compares equal.
# ---------------------------------------------------------------------------
echo ""
echo "=== the script agrees with the vitest constants it mirrors ==="

if [ ! -f "$ARTIFACT_TEST" ]; then
  fail "artifact test not found: $ARTIFACT_TEST (cannot prove the known pair agrees)"
else
  SCRIPT_CATEGORY="$(sed -nE 's/^CATEGORY="\$\{DOCS_CHECK_CATEGORY:-([^}]+)\}"$/\1/p' "$SCRIPT" | head -1)"
  SCRIPT_COMMAND="$(sed -nE 's/^COMMAND="\$\{DOCS_CHECK_COMMAND:-([^}]+)\}"$/\1/p' "$SCRIPT" | head -1)"
  TEST_CATEGORY="$(sed -nE "s/^const KNOWN_CATEGORY = '([^']+)';$/\1/p" "$ARTIFACT_TEST" | head -1)"
  TEST_COMMAND="$(sed -nE "s/^const KNOWN_PUBLIC_COMMAND = '([^']+)';$/\1/p" "$ARTIFACT_TEST" | head -1)"
  if [ -n "$SCRIPT_CATEGORY" ] && [ -n "$SCRIPT_COMMAND" ] && [ -n "$TEST_CATEGORY" ] && [ -n "$TEST_COMMAND" ]; then
    pass "extracted the known pair from both files (script: $SCRIPT_CATEGORY/$SCRIPT_COMMAND, vitest: $TEST_CATEGORY/$TEST_COMMAND)"
    if [ "$SCRIPT_CATEGORY" = "$TEST_CATEGORY" ] && [ "$SCRIPT_COMMAND" = "$TEST_COMMAND" ]; then
      pass "the script's default category/command equals the pair the artifact test proves is in the shipped manifest"
    else
      fail "known pair drift: script probes $SCRIPT_CATEGORY/$SCRIPT_COMMAND, the artifact test pins $TEST_CATEGORY/$TEST_COMMAND — update both in the same PR"
    fi
  else
    fail "could not extract the known pair (script: '$SCRIPT_CATEGORY'/'$SCRIPT_COMMAND', vitest: '$TEST_CATEGORY'/'$TEST_COMMAND') — a shape change made this pin vacuous"
  fi
fi

if [ ! -f "$COMMIT_MODULE" ]; then
  fail "commit module not found: $COMMIT_MODULE (cannot prove the meta name agrees)"
else
  SCRIPT_META="$(sed -nE "s/^COMMIT_META_NAME='([^']+)'$/\1/p" "$SCRIPT" | head -1)"
  MODULE_META="$(sed -nE "s/^export const DOCS_COMMIT_META_NAME = '([^']+)';$/\1/p" "$COMMIT_MODULE" | head -1)"
  if [ -n "$SCRIPT_META" ] && [ "$SCRIPT_META" = "$MODULE_META" ]; then
    pass "the script greps the same <meta name> the layout renders ($SCRIPT_META)"
  else
    fail "commit meta name drift or extraction failure (script: '$SCRIPT_META', lib/commit.ts: '$MODULE_META')"
  fi
  if [ "$SCRIPT_META" = "spawnforge-docs-commit" ]; then
    pass "the fixtures above stamp the name the script actually looks for"
  else
    fail "the suite's stamp() fixture uses 'spawnforge-docs-commit' but the script looks for '$SCRIPT_META' — the passing cases above are not exercising the real name"
  fi

  # The second thing the two files must agree on, and the one no runtime case
  # can reach: the script compares the leading COMMIT_COMPARE_WIDTH chars, so a
  # stamp SHORTER than that can never equal the commit it names. A build whose
  # VERCEL_GIT_COMMIT_SHA is a 7-char abbreviation of the very commit under
  # test would be reported as a DIFFERENT build and the deploy would fail
  # closed on a mismatch that does not exist. The module's accepted minimum
  # must therefore be at least the script's comparison width. Both extractions
  # must be non-empty — comparing two empty strings passes vacuously.
  # SCRIPT_WIDTH is extracted at the top of this file and its extraction is
  # already fatal there, so only the module side can be empty here.
  MODULE_SHA_MIN="$(sed -nE 's/^const GIT_SHA = \/\^\[0-9a-fA-F\]\{([0-9]+),[0-9]+\}\$\/;$/\1/p' "$COMMIT_MODULE" | head -1)"
  if [ -n "$SCRIPT_WIDTH" ] && [ -n "$MODULE_SHA_MIN" ]; then
    pass "extracted both minimums (script compares $SCRIPT_WIDTH chars; lib/commit.ts renders a stamp of $MODULE_SHA_MIN+ hex chars)"
    if [ "$MODULE_SHA_MIN" -ge "$SCRIPT_WIDTH" ]; then
      pass "lib/commit.ts's GIT_SHA minimum ($MODULE_SHA_MIN) is at least the width the gate compares ($SCRIPT_WIDTH)"
    else
      fail "stamp-width drift: lib/commit.ts renders stamps as short as $MODULE_SHA_MIN chars but the gate compares $SCRIPT_WIDTH — a short stamp of the deployed commit reads as a DIFFERENT build. Raise the {min,40} in apps/docs/lib/commit.ts to $SCRIPT_WIDTH."
    fi
  else
    fail "could not extract the minimums (script COMMIT_COMPARE_WIDTH: '$SCRIPT_WIDTH', lib/commit.ts GIT_SHA: '$MODULE_SHA_MIN') — a shape change made this pin vacuous"
  fi
fi

# ---------------------------------------------------------------------------
# cd.yml wiring. The script only gates a deploy if the deploy job runs it,
# AFTER the deploy, unconditionally, and as that step's only run: line.
# ---------------------------------------------------------------------------
echo ""
echo "=== cd.yml runs the gate after the docs deploy ==="

# Comment-strip, then cut the deploy-docs job (job keys sit at exactly two
# spaces of indent).
CD_EXEC="$(awk '{ line=$0; sub(/[[:space:]]*#.*/, "", line); if (line ~ /^[[:space:]]*$/) next; print }' "$CD_YML")"
JOB_COUNT="$(grep -cE '^  deploy-docs[[:space:]]*:' <<<"$CD_EXEC" || true)"
if [ "$JOB_COUNT" = "1" ]; then
  pass "cd.yml defines the deploy-docs job exactly once"
else
  fail "cd.yml defines deploy-docs $JOB_COUNT times (expected 1) — a duplicate job key replaces the whole job, wiring included"
fi
JOB="$(awk '$0 ~ /^  deploy-docs[[:space:]]*:/ {f=1; print; next} f && /^  [A-Za-z_-]+[[:space:]]*:/ {exit} f {print}' <<<"$CD_EXEC")"
if [ -z "$JOB" ]; then
  fail "could not cut the deploy-docs job out of cd.yml — the pins below would pass vacuously"
  echo "SUITE FAILED"
  exit 1
fi

DEPLOY_LINE="$(grep -nE '^[[:space:]]*run: vercel deploy --prod' <<<"$JOB" | head -1 | cut -d: -f1)"
GATE_LINE="$(grep -nE '^[[:space:]]*run: bash scripts/post-deploy-docs-check\.sh ' <<<"$JOB" | head -1 | cut -d: -f1)"
GATE_COUNT="$(grep -cE '^[[:space:]]*run: bash scripts/post-deploy-docs-check\.sh ' <<<"$JOB" || true)"
if [ "$GATE_COUNT" = "1" ]; then
  pass "deploy-docs runs scripts/post-deploy-docs-check.sh exactly once"
else
  fail "deploy-docs runs scripts/post-deploy-docs-check.sh $GATE_COUNT times (expected 1)"
fi
if [ -n "$DEPLOY_LINE" ] && [ -n "$GATE_LINE" ] && [ "$GATE_LINE" -gt "$DEPLOY_LINE" ]; then
  pass "the gate step comes AFTER 'vercel deploy --prod' (it probes what that step published)"
else
  fail "the gate is not positioned after the deploy step (deploy at line ${DEPLOY_LINE:-none}, gate at line ${GATE_LINE:-none})"
fi

# Cut the gate's step block: from its `- name:` up to the next `- ` at the same
# indent, then pin what may and may not appear inside it.
STEP="$(awk -v gate='run: bash scripts/post-deploy-docs-check.sh' '
  /^      - / { if (found) exit; blk=""; }
  { blk = blk $0 "\n" }
  index($0, gate) { found=1 }
  END { if (found) printf "%s", blk }' <<<"$JOB")"
if [ -z "$STEP" ]; then
  fail "could not cut the gate step block — its pins below would pass vacuously"
else
  if grep -qE '^[[:space:]]*if[[:space:]]*:' <<<"$STEP"; then
    fail "the gate step carries a step-level if: — it can be skipped while its run: line still greps as present"
  else
    pass "the gate step has no step-level if:"
  fi
  if grep -q 'continue-on-error' <<<"$STEP"; then
    fail "the gate step carries continue-on-error — a red probe would not stop the job"
  else
    pass "the gate step has no continue-on-error"
  fi
  RUN_COUNT="$(grep -cE '^[[:space:]]*run[[:space:]]*:' <<<"$STEP" || true)"
  if [ "$RUN_COUNT" = "1" ]; then
    pass "the gate step has exactly one run: key (a second, last-wins run: would replace it silently)"
  else
    fail "the gate step has $RUN_COUNT run: keys (expected 1)"
  fi
  # shellcheck disable=SC2016  # the literal "$DOCS_URL" IS the text cd.yml must carry
  if grep -qE '^[[:space:]]*run: bash scripts/post-deploy-docs-check\.sh "\$DOCS_URL"[[:space:]]*$' <<<"$STEP"; then
    pass "the gate's run: line is exactly 'bash scripts/post-deploy-docs-check.sh \"\$DOCS_URL\"'"
  else
    fail "the gate's run: line has been rewritten or suffixed: $(grep -E 'run:' <<<"$STEP")"
  fi
  if grep -qE '^[[:space:]]*DOCS_URL: https://docs\.spawnforge\.ai[[:space:]]*$' <<<"$STEP"; then
    pass "the gate probes the production alias https://docs.spawnforge.ai"
  else
    fail "DOCS_URL is not pinned to https://docs.spawnforge.ai in the gate step"
  fi
  # shellcheck disable=SC2016  # the literal ${{ github.sha }} IS the text cd.yml must carry
  COMMIT_ENV_COUNT="$(grep -cF 'DOCS_CHECK_EXPECT_COMMIT: ${{ github.sha }}' <<<"$STEP" || true)"
  if [ "$COMMIT_ENV_COUNT" = "1" ]; then
    pass "the gate step passes DOCS_CHECK_EXPECT_COMMIT from github.sha exactly once (the probe is tied to THIS deploy)"
  else
    fail "DOCS_CHECK_EXPECT_COMMIT: \${{ github.sha }} appears $COMMIT_ENV_COUNT times in the gate step (expected 1) — without it the script refuses to run, and with a duplicate the last one wins silently"
  fi
fi

# ---------------------------------------------------------------------------
# Seam self-defense. DOCS_RESPONSE_FILE exists so this suite can read the body
# the script fetched; a workflow that set it would redirect the real probe's
# output. Comment-stripped scan, fail closed on a missing dir or a grep error.
#
# scan_seam <dir>: prints the non-comment hits and returns grep's OWN status —
# 0 hits, 1 none, >= 2 error. The status is captured directly from the grep
# (`rc=$?` on the substitution), not read from PIPESTATUS afterwards:
# PIPESTATUS does not propagate out of a command substitution, so the earlier
# `SCAN_RC=${PIPESTATUS[0]:-0}` after `X="$(grep ... | grep -v ... || true)"`
# always read 0 and the "grep failed" arm could never fire (lesson 11). The
# self-test below proves each arm is reachable before the real scan runs.
# ---------------------------------------------------------------------------
echo ""
echo "=== the test seam is not wired in CI ==="

scan_seam() {
  local dir="$1" raw rc
  raw="$(grep -rn --include='*.yml' --include='*.yaml' 'DOCS_RESPONSE_FILE' "$dir" 2>&1)"; rc=$?
  if [ "$rc" -ge 2 ]; then
    printf '%s\n' "$raw"
    return "$rc"
  fi
  grep -vE ':[[:space:]]*#' <<<"$raw" || true
  return "$rc"
}

# Self-test: every arm of the scan can fire.
SEAM_FIX="$TMP/seam"
mkdir -p "$SEAM_FIX/hit" "$SEAM_FIX/comment-only" "$SEAM_FIX/clean"
printf 'env:\n  DOCS_RESPONSE_FILE: /tmp/redirected.html\n' > "$SEAM_FIX/hit/a.yml"
printf 'steps:\n  # DOCS_RESPONSE_FILE is a test seam, never set here\n  - run: true\n' > "$SEAM_FIX/comment-only/b.yaml"
printf 'steps:\n  - run: true\n' > "$SEAM_FIX/clean/c.yml"

SELF_OUT="$(scan_seam "$SEAM_FIX/does-not-exist")"; SELF_RC=$?
if [ "$SELF_RC" -ge 2 ] && [ -n "$SELF_OUT" ]; then
  pass "scan_seam returns grep's error status (rc=$SELF_RC) and its message when the scan itself fails — the fail-closed arm is reachable"
else
  fail "scan_seam did not surface a grep error (rc=$SELF_RC, out='$SELF_OUT') — the fail-closed arm below is dead"
fi
SELF_OUT="$(scan_seam "$SEAM_FIX/hit")"; SELF_RC=$?
if [ "$SELF_RC" = 0 ] && grep -q 'DOCS_RESPONSE_FILE: /tmp/redirected.html' <<<"$SELF_OUT"; then
  pass "scan_seam reports a live DOCS_RESPONSE_FILE wiring (rc=0, hit printed)"
else
  fail "scan_seam missed a live wiring (rc=$SELF_RC, out='$SELF_OUT')"
fi
SELF_OUT="$(scan_seam "$SEAM_FIX/comment-only")"; SELF_RC=$?
if [ "$SELF_RC" = 0 ] && [ -z "$SELF_OUT" ]; then
  pass "scan_seam ignores a mention inside a YAML comment (rc=0, nothing printed)"
else
  fail "scan_seam treated a comment as a wiring (rc=$SELF_RC, out='$SELF_OUT')"
fi
SELF_OUT="$(scan_seam "$SEAM_FIX/clean")"; SELF_RC=$?
if [ "$SELF_RC" = 1 ] && [ -z "$SELF_OUT" ]; then
  pass "scan_seam returns 1 with nothing printed for a clean tree"
else
  fail "scan_seam misreported a clean tree (rc=$SELF_RC, out='$SELF_OUT')"
fi

# The real scan.
if [ ! -d "$WORKFLOW_DIR" ]; then
  fail "workflow dir missing: $WORKFLOW_DIR (cannot prove the seam is unwired)"
else
  SEAM_HITS="$(scan_seam "$WORKFLOW_DIR")"; SCAN_RC=$?
  if [ "$SCAN_RC" -ge 2 ]; then
    fail "grep failed while scanning $WORKFLOW_DIR for the seam (rc=$SCAN_RC): $SEAM_HITS"
  elif [ -n "$SEAM_HITS" ]; then
    fail "DOCS_RESPONSE_FILE is wired in a workflow — the live probe's response would be redirected: $SEAM_HITS"
  else
    pass "no workflow sets DOCS_RESPONSE_FILE"
  fi
fi

echo ""
echo "PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -eq 0 ] && [ "$PASS" -gt 0 ]; then
  echo "SUITE PASSED"
  exit 0
fi
echo "SUITE FAILED"
exit 1
