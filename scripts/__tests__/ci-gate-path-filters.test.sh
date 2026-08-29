#!/usr/bin/env bash
# Unit tests for the `Detect changed paths` step of the `ci-gate` job in
# .github/workflows/ci.yml.
#
# WHY THIS STEP IS TESTED
# -----------------------
# `ci-gate` decides, from a `git diff --name-only` list, which downstream jobs
# run. Every one of its fourteen outputs is a grep against that list. A gate
# whose trigger does not fire is indistinguishable from a gate that passed:
# GitHub renders a skipped required check as green, and `check-ci-success.sh`
# deliberately tolerates a legitimate path-filter skip. So an under-scoped grep
# here silently disables a real check on exactly the PRs that needed it.
#
# That is not hypothetical. #8620: the `docs` filter listed the CANONICAL MCP
# manifest directory (`^mcp-server/manifest/`) but never the WEB COPY
# (`web/src/data/commands.json`). `docs-internal-gate` runs
# `apps/docs/scripts/check-manifest-sync.ts` — the only check comparing the
# canonical manifest against its two derived copies. A PR editing only the web
# copy set `needs-web=true` and `needs-docs=false`, so the sync check never ran.
# `web/src/lib/chat/tools.ts` imports that web copy to build the Anthropic tool
# definitions served to the chat API, so a drifted copy changed the live tool
# surface with zero CI detection. `command-parity` does not cover it either: it
# reads only the canonical manifest.
#
# HOW THESE TESTS WORK
# --------------------
# The step's `run:` body is EXTRACTED from ci.yml at test time and executed with
# `CHANGED` pre-set to a synthetic file list and `GITHUB_OUTPUT` pointed at a
# temp file. Nothing is duplicated: if someone edits a grep in ci.yml, these
# tests run the edited grep. A test that asserted against its own copy of the
# patterns would pass by construction and prove nothing.
#
# The extractor is guarded (see `assert_extraction_is_real`): if ci.yml is
# restructured into a shape it cannot read, the suite FAILS with an instruction
# to extend the extractor. It never reports success on an empty parse.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
FAILURES=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ -f "$CI_YML" ] || { echo "ci.yml not found: $CI_YML"; exit 1; }

TMPDIR_TEST="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_TEST"' EXIT

STEP_BODY="$TMPDIR_TEST/detect-changed-paths.sh"

# ---- Extract the step body from ci.yml -------------------------------------
#
# Finds `- name: Detect changed paths`, then the `run: |` under it, then takes
# every following line indented at least as far as the first body line,
# dedented to column 0. The `git diff` line is dropped so the harness can
# supply CHANGED itself (it is the only line referencing BASE_SHA/HEAD_SHA).
extract_step_body() {
  awk '
    /^      - name: Detect changed paths$/ { instep = 1; next }
    instep && /^ *run: \|$/ { inrun = 1; next }
    inrun {
      if ($0 ~ /^[[:space:]]*$/) { print ""; next }
      match($0, /^ */); ind = RLENGTH
      if (base == 0) base = ind
      if (ind < base) exit
      print substr($0, base + 1)
    }
  ' "$CI_YML" | grep -v '^CHANGED='
}

extract_step_body > "$STEP_BODY"

# ---- Non-vacuity guard ------------------------------------------------------
#
# Without this, a restructured ci.yml would yield an empty body, every scenario
# would read every output as empty-string, and a suite of `!= true` assertions
# would go green while testing nothing.
assert_extraction_is_real() {
  local body_lines
  body_lines=$(grep -cve '^[[:space:]]*$' "$STEP_BODY")
  if [ "$body_lines" -lt 20 ]; then
    echo "  FAIL: extracted only $body_lines non-blank lines from the 'Detect changed paths' step."
    echo "        ci.yml has been restructured into a shape extract_step_body() cannot read."
    echo "        Extend the extractor first; do NOT relax this assertion."
    exit 1
  fi
  local sentinel missing=0
  # One sentinel per output, so a step that still parses but has lost a whole
  # filter cannot slip past as "real enough".
  for sentinel in 'web=true' 'engine=true' 'mcp=true' 'ci=true' 'docs=true' \
                  'design=true' 'hooks=true' 'deps=true' 'agentic=true' \
                  'onboarding=true' 'codex=true' 'ghaw=true' 'api=true' \
                  'skills=true' 'any-code='; do
    grep -qF "$sentinel" "$STEP_BODY" || { echo "  FAIL: extracted body has no '$sentinel'"; missing=1; }
  done
  [ "$missing" -eq 0 ] || exit 1
  pass "step body extracted from ci.yml ($body_lines lines, all 15 outputs present)"
}

# ---- Harness ----------------------------------------------------------------
#
# run_gate <newline-separated file list> -> prints `key=value` lines
run_gate() {
  local changed="$1"
  local out="$TMPDIR_TEST/out.$$"
  : > "$out"
  CHANGED="$changed" GITHUB_OUTPUT="$out" bash -c '
    CHANGED="$CHANGED"
    source "$1"
  ' _ "$STEP_BODY" > /dev/null 2>&1
  cat "$out"
  rm -f "$out"
}

# assert_output <case name> <file list> <key> <expected>
assert_output() {
  local name="$1" changed="$2" key="$3" expected="$4"
  local actual
  actual=$(run_gate "$changed" | grep "^${key}=" | cut -d= -f2-)
  if [ "$actual" = "$expected" ]; then
    pass "$name: $key=$expected"
  else
    fail "$name: expected $key=$expected, got '${actual:-<unset>}'"
  fi
}

echo "=== ci-gate path filters ==="
assert_extraction_is_real

# ---- #8620: the web copy of the MCP manifest must fire the docs gate --------
echo "--- MCP manifest copies (#8620) ---"
assert_output "web copy alone fires docs" "web/src/data/commands.json" docs true
assert_output "web copy alone still fires web" "web/src/data/commands.json" web true
assert_output "canonical manifest fires docs" "mcp-server/manifest/commands.json" docs true
assert_output "docs copy fires docs" "apps/docs/data/commands.json" docs true
assert_output "the sync gate script fires docs" "apps/docs/scripts/check-manifest-sync.ts" docs true

# Controls. Without these the docs filter could be `docs=true` unconditionally
# and every assertion above would still pass.
assert_output "unrelated web file does NOT fire docs" "web/src/app/page.tsx" docs false
assert_output "engine file does NOT fire docs" "engine/src/lib.rs" docs false
# The alternative is anchored with a trailing $ and an escaped dot; a
# near-miss path must not match.
assert_output "near-miss path does NOT fire docs" "web/src/data/commands.jsonx" docs false
assert_output "commands.json elsewhere does NOT fire docs" "web/src/other/commands.json" docs false

# ---- The other thirteen outputs ---------------------------------------------
echo "--- other filters ---"
assert_output "engine source fires engine" "engine/src/lib.rs" engine true
assert_output "mcp-server fires mcp" "mcp-server/src/index.ts" mcp true
assert_output "workflow edit fires ci" ".github/workflows/ci.yml" ci true
assert_output "packages/ui fires design" "packages/ui/src/Button.tsx" design true
assert_output "hook script fires hooks" ".claude/hooks/inject-lessons-learned.sh" hooks true
assert_output "nested package.json fires deps" "web/package.json" deps true
assert_output "root lockfile fires deps" "package-lock.json" deps true
assert_output "agentic source fires agentic" "tools/agentic-sync/facts.json" agentic true
assert_output "README fires onboarding" "README.md" onboarding true
assert_output "codex config fires codex" ".codex/config.toml" codex true
assert_output "gh-aw lock fires ghaw" ".github/workflows/weekly-health.lock.yml" ghaw true
assert_output "api route fires api" "web/src/app/api/generate/gdd/route.ts" api true
assert_output "published spec fires api" "docs/api/openapi.json" api true
assert_output "SKILL.md fires skills" ".claude/skills/kanban/SKILL.md" skills true

# ---- Orthogonality pins -----------------------------------------------------
#
# ci.yml documents in prose that hooks/deps/agentic/onboarding/codex/skills are
# deliberately kept OUT of any-code so a config-only edit does not pay the heavy
# quality-gates fan-out. Prose does not fail a build; these do.
echo "--- any-code orthogonality ---"
assert_output "hook-only change does not set any-code" ".claude/hooks/x.sh" any-code false
assert_output "codex-config-only change does not set any-code" ".codex/config.toml" any-code false
assert_output "SKILL.md-only change does not set any-code" ".claude/skills/kanban/SKILL.md" any-code false
assert_output "web change DOES set any-code" "web/src/app/page.tsx" any-code true
assert_output "docs copy DOES set any-code" "web/src/data/commands.json" any-code true

# ---- Empty diff -------------------------------------------------------------
echo "--- empty diff ---"
assert_output "empty diff leaves docs false" "" docs false
assert_output "empty diff leaves any-code false" "" any-code false
assert_output "empty diff leaves deps false" "" deps false

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "ci-gate path filters: all checks passed"
  exit 0
fi
echo "ci-gate path filters: $FAILURES check(s) failed"
exit 1
