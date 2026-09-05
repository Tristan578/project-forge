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
# This gate asks two. `/mcp` must be 200 AND list a category tile — the page
# renders "No public commands available yet" with a 200 when the manifest is
# empty, so status alone is lesson 1's "adjacent property". `/mcp/<category>`
# must be 200 AND name a known command. A 200 with no commands is not a pass.
#
# Most cases below are REFUSAL cases, and the whole script runs against a
# stubbed `curl` so the suite needs no network.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../post-deploy-docs-check.sh"
CD_YML="$HERE/../../.github/workflows/cd.yml"
WORKFLOW_DIR="$HERE/../../.github/workflows"

PASS=0
FAIL=0
pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

[ -f "$SCRIPT" ] || { echo "  FAIL: script not found: $SCRIPT"; echo "SUITE FAILED"; exit 1; }
[ -f "$CD_YML" ] || { echo "  FAIL: workflow not found: $CD_YML"; echo "SUITE FAILED"; exit 1; }

# ---------------------------------------------------------------------------
# The whole script against a stubbed curl.
#
# The stub records its argv, picks a fixture by the URL it was asked for
# (`.../mcp` -> index, anything under `.../mcp/` -> category), writes that
# fixture's body to --output and prints its status for -w.
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
[ -n "$out" ] && cat "$STUB_DIR/$which.body" > "$out"
cat "$STUB_DIR/$which.status"
EOF
chmod +x "$TMP/bin/curl"

# The shapes the live pages render. A category tile is the ONLY thing `/mcp`
# emits when publicCount > 0 that it does not emit when publicCount == 0.
INDEX_OK='<main><p>282 public commands across 35 categories.</p><ul><li><a href="/mcp/scene">scene</a></li><li><a href="/mcp/camera">camera</a></li></ul></main>'
INDEX_EMPTY='<main><p>No public commands available yet. Commands are being reviewed for public documentation.</p></main>'
CATEGORY_OK='<main><h1>scene</h1><p>12 public commands in this category.</p><ul><li id="spawn_entity"><h2>spawn_entity</h2></li><li id="despawn_entity"><h2>despawn_entity</h2></li></ul></main>'
CATEGORY_EMPTY='<main><h1>scene</h1><p>0 public commands in this category.</p><ul></ul></main>'
SERVER_ERROR='Internal Server Error'
NOT_FOUND='<html><body>404: This page could not be found.</body></html>'

# e2e <index-status> <index-body> <category-status> <category-body>
e2e() {
  printf '%s' "$1" > "$TMP/index.status"
  printf '%s' "$2" > "$TMP/index.body"
  printf '%s' "$3" > "$TMP/category.status"
  printf '%s' "$4" > "$TMP/category.body"
  printf '%s' "500" > "$TMP/other.status"
  printf '%s' "unexpected url" > "$TMP/other.body"
  : > "$TMP/args"
  (
    PATH="$TMP/bin:$PATH" STUB_DIR="$TMP" STUB_ARGS="$TMP/args" \
    DOCS_RESPONSE_FILE="$TMP/resp.html" \
    DOCS_CHECK_STABILIZE_S=0 DOCS_CHECK_INTERVAL_S=0 DOCS_CHECK_RETRIES="${RETRIES:-2}" \
    bash "$SCRIPT" "${URL:-https://docs.example.test}" 2>&1
  )
}

# --- refusal: no target ---
OUT="$(bash "$SCRIPT" 2>&1)"; RC=$?
if [ "$RC" != 0 ] && grep -q 'Usage' <<<"$OUT"; then
  pass "no base URL is a usage error, not a vacuous pass"
else
  fail "missing argument did not fail with usage (rc=$RC): $OUT"
fi

# --- accepting ---
OUT="$(e2e 200 "$INDEX_OK" 200 "$CATEGORY_OK")"; RC=$?
if [ "$RC" = 0 ]; then
  pass "200 + a category tile on /mcp, 200 + the known command on /mcp/scene: passes end to end"
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

OUT="$(DOCS_CHECK_CATEGORY=camera DOCS_CHECK_COMMAND=zoom_camera e2e 200 "$INDEX_OK" 200 '<h2>zoom_camera</h2>')"; RC=$?
if [ "$RC" = 0 ] && grep -qx 'https://docs.example.test/mcp/camera' "$TMP/args"; then
  pass "DOCS_CHECK_CATEGORY / DOCS_CHECK_COMMAND select the category page and the name looked for"
else
  fail "category/command overrides were not honoured: $(tr '\n' ' ' < "$TMP/args") $OUT"
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
OUT="$(e2e 200 "$INDEX_OK" 200 '<p>Unlike spawn_entity, this one is different.</p>')"; RC=$?
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

# Deployment Protection answering the probe means the check cannot observe the
# site. That is a failure, not a skip (#9624's lesson, applied here).
for code in 401 403; do
  OUT="$(e2e "$code" 'Authentication Required' 200 "$CATEGORY_OK")"; RC=$?
  if [ "$RC" != 0 ] && grep -qi 'cannot be observed\|protection' <<<"$OUT"; then
    pass "a $code fails closed and says the deployment could not be observed"
  else
    fail "a $code did not fail closed with a diagnosis (rc=$RC): $OUT"
  fi
done

# Retries: a transient failure followed by success must pass; the stub cannot
# change its answer between calls, so assert the retry COUNT instead — every
# attempt hits the index route before the category route is ever tried.
OUT="$(RETRIES=3 e2e 503 'Service Unavailable' 200 "$CATEGORY_OK")"; RC=$?
INDEX_HITS="$(grep -cx 'https://docs.example.test/mcp' "$TMP/args" || true)"
if [ "$RC" != 0 ] && [ "$INDEX_HITS" = "3" ]; then
  pass "a persistent non-200 is retried DOCS_CHECK_RETRIES times before failing (saw $INDEX_HITS attempts)"
else
  fail "expected 3 attempts on /mcp before failing, saw $INDEX_HITS (rc=$RC): $OUT"
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
fi

# ---------------------------------------------------------------------------
# Seam self-defense. DOCS_RESPONSE_FILE exists so this suite can read the body
# the script fetched; a workflow that set it would redirect the real probe's
# output. Comment-stripped scan, fail closed on a missing dir or a grep error.
# ---------------------------------------------------------------------------
echo ""
echo "=== the test seam is not wired in CI ==="

if [ ! -d "$WORKFLOW_DIR" ]; then
  fail "workflow dir missing: $WORKFLOW_DIR (cannot prove the seam is unwired)"
else
  SEAM_HITS="$(grep -rn --include='*.yml' --include='*.yaml' 'DOCS_RESPONSE_FILE' "$WORKFLOW_DIR" 2>/dev/null | grep -vE ':[[:space:]]*#' || true)"
  SCAN_RC=${PIPESTATUS[0]:-0}
  if [ "$SCAN_RC" -ge 2 ]; then
    fail "grep failed while scanning $WORKFLOW_DIR for the seam (rc=$SCAN_RC)"
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
