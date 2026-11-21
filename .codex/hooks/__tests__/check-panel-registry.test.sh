#!/usr/bin/env bash
# Tests for check-panel-registry.sh — the panelRegistry insertion guard.
#
# Exit codes ARE the behaviour: 0 = not our file, or suite passed. 2 = suite
# failed, or the guard could not determine an answer.
#
# The fail-CLOSED cases carry the weight here. A guard that exits 0 when it
# cannot run reports "clean" for every edit after the toolchain shifts, and its
# output is indistinguishable from a real pass — so "npx missing", "no repo",
# "suite file gone" each get their own case asserting 2, not 0.
#
# The hook is driven entirely through TOOL_INPUT_file_path, the working
# directory, and $PATH. There is deliberately NO env seam inside the hook: a
# stub `npx` earlier on $PATH is what makes the pass/fail branches testable, so
# the hook carries nothing CI could set to neuter it, and none of the fixture-
# seam anti-tamper machinery in .claude/rules/hook-testing.md applies.
set -u

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/check-panel-registry.sh"
FAILURES=0

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "SKIP-FAIL: required tool '$1' not on PATH" >&2
    exit 1
  fi
}
require git

[ -f "$HOOK" ] || { echo "hook not found: $HOOK" >&2; exit 1; }

assert_exit() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$actual" -eq "$expected" ]; then
    echo "ok   - $desc"
  else
    echo "FAIL - $desc (expected exit $expected, got $actual)"
    FAILURES=$((FAILURES + 1))
  fi
}

assert_contains() {
  local desc="$1" needle="$2" haystack="$3"
  if printf '%s' "$haystack" | grep -qF "$needle"; then
    echo "ok   - $desc"
  else
    echo "FAIL - $desc (output did not contain '$needle')"
    FAILURES=$((FAILURES + 1))
  fi
}

TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT

# ---- Fixture repo -----------------------------------------------------------
#
# A real git repo, because the hook locates web/ via `git rev-parse
# --show-toplevel`. The suite file only has to EXIST; a stub `npx` decides the
# verdict, so no vitest, no node_modules and no network are involved.
FIXTURE="$TMPROOT/repo"
mkdir -p "$FIXTURE/web/src/lib/workspace/__tests__"
git -C "$FIXTURE" init -q
: > "$FIXTURE/web/src/lib/workspace/panelRegistry.ts"
: > "$FIXTURE/web/src/lib/workspace/__tests__/panelRegistry.test.ts"

# Stub `npx` directories. Placed FIRST on $PATH so they shadow any real npx.
PASS_BIN="$TMPROOT/bin-pass"
FAIL_BIN="$TMPROOT/bin-fail"
EMPTY_BIN="$TMPROOT/bin-empty"
mkdir -p "$PASS_BIN" "$FAIL_BIN" "$EMPTY_BIN"

cat > "$PASS_BIN/npx" <<'STUB'
#!/usr/bin/env bash
echo "Test Files  1 passed (1)"
exit 0
STUB
cat > "$FAIL_BIN/npx" <<'STUB'
#!/usr/bin/env bash
echo "FAIL src/lib/workspace/__tests__/panelRegistry.test.ts > every panel id is registered"
exit 1
STUB
chmod +x "$PASS_BIN/npx" "$FAIL_BIN/npx"

# A PATH holding only the stub dir plus the tools the hook itself needs, so the
# "npx unavailable" case cannot accidentally find the real one.
#
# git's directory is resolved rather than assumed: it is /usr/bin on a Linux
# runner but /mingw64/bin under Git Bash, and hardcoding the former made the
# hook fail its repo lookup on Windows and report "not inside a git repository"
# for every case — a green-looking harness bug that would have masked the real
# assertions.
GIT_BIN_DIR="$(cd "$(dirname "$(command -v git)")" && pwd)"
MINIMAL_PATH() { printf '%s:%s:/usr/bin:/bin' "$1" "$GIT_BIN_DIR"; }

# The "npx unavailable" case is only meaningful if npx really is unreachable
# from that PATH. If a future toolchain puts npx beside git, this assertion is
# what tells us, instead of the case quietly proving nothing.
if PATH="$(MINIMAL_PATH "$EMPTY_BIN")" command -v npx >/dev/null 2>&1; then
  echo "FAIL - the empty-stub PATH can still reach a real npx; the fail-closed case would prove nothing"
  FAILURES=$((FAILURES + 1))
fi

# run <stub-dir-or-empty> <file-path> [cwd] -> sets RC and OUT
run_hook() {
  local bin="$1" file="$2" cwd="${3:-$FIXTURE}"
  local out
  RC=0
  out="$(cd "$cwd" && PATH="$(MINIMAL_PATH "$bin")" TOOL_INPUT_file_path="$file" bash "$HOOK" 2>&1)" || RC=$?
  OUT="$out"
}

# ---- Non-matching paths: exit 0, and do it without touching the toolchain ----
#
# Deliberately run with the EMPTY stub dir: an unrelated edit must not need npx,
# a repo, or anything else. If the early-exit ever moves below the git lookup
# this case turns red rather than merely slow.
for other in \
  'web/src/lib/workspace/presets.ts' \
  'web/src/components/editor/EditorLayout.tsx' \
  'web/src/lib/workspace/__tests__/panelRegistry.test.ts' \
  'docs/panelRegistry.ts.md' \
  ''
do
  run_hook "$EMPTY_BIN" "$other"
  assert_exit "unrelated path '${other:-<empty>}' exits 0" 0 "$RC"
done

# A path that merely CONTAINS the target name elsewhere must not match either.
run_hook "$EMPTY_BIN" 'web/src/lib/workspace/panelRegistry.ts.bak'
assert_exit "suffix near-miss (panelRegistry.ts.bak) exits 0" 0 "$RC"

# ---- Matching path, suite passes --------------------------------------------
run_hook "$PASS_BIN" "$FIXTURE/web/src/lib/workspace/panelRegistry.ts"
assert_exit "matching path with a passing suite exits 0" 0 "$RC"

run_hook "$PASS_BIN" 'web/src/lib/workspace/panelRegistry.ts'
assert_exit "matching RELATIVE path with a passing suite exits 0" 0 "$RC"

# Windows tool inputs arrive with backslashes; the hook normalises them.
run_hook "$PASS_BIN" 'web\src\lib\workspace\panelRegistry.ts'
assert_exit "matching Windows-separator path exits 0" 0 "$RC"

# The guard must work from a SUBDIRECTORY too — PostToolUse fires wherever the
# agent happens to be.
run_hook "$PASS_BIN" 'web/src/lib/workspace/panelRegistry.ts' "$FIXTURE/web"
assert_exit "matching path from a subdirectory exits 0" 0 "$RC"

# ---- Matching path, suite fails ---------------------------------------------
run_hook "$FAIL_BIN" 'web/src/lib/workspace/panelRegistry.ts'
assert_exit "matching path with a failing suite exits 2" 2 "$RC"
assert_contains "failure names the broken suite" 'panelRegistry.test.ts' "$OUT"
assert_contains "failure says the edit is blocked" 'BLOCKED' "$OUT"

# ---- Fail closed: the verdict is unknown ------------------------------------
run_hook "$EMPTY_BIN" 'web/src/lib/workspace/panelRegistry.ts'
assert_exit "npx unavailable exits 2 rather than passing silently" 2 "$RC"
assert_contains "npx-unavailable message names the cause" 'npx is not on PATH' "$OUT"

# No git repo at all.
NOREPO="$TMPROOT/norepo"
mkdir -p "$NOREPO"
run_hook "$PASS_BIN" 'web/src/lib/workspace/panelRegistry.ts' "$NOREPO"
assert_exit "outside a git repository exits 2" 2 "$RC"

# Repo exists, but the suite the guard runs does not.
NOSUITE="$TMPROOT/nosuite"
mkdir -p "$NOSUITE/web/src/lib/workspace"
git -C "$NOSUITE" init -q
run_hook "$PASS_BIN" 'web/src/lib/workspace/panelRegistry.ts' "$NOSUITE"
assert_exit "missing suite file exits 2" 2 "$RC"
assert_contains "missing-suite message names the file" 'panelRegistry.test.ts' "$OUT"

# ---- Registration -----------------------------------------------------------
#
# A hook nothing invokes is not a guard. Subagents do NOT inherit
# settings.json hooks, so the builder agent registers it in its own frontmatter
# — and settings.json is off-limits for this change by design.
BUILDER="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/agents/builder.md"
if [ ! -f "$BUILDER" ]; then
  echo "FAIL - .claude/agents/builder.md not found at $BUILDER"
  FAILURES=$((FAILURES + 1))
else
  builder_src="$(cat "$BUILDER")"
  assert_contains "builder.md invokes the hook" 'check-panel-registry.sh' "$builder_src"
  if printf '%s' "$builder_src" \
    | awk '/^  PostToolUse:/{p=1;next} /^  [A-Za-z]+:/{p=0} p' \
    | grep -qF 'check-panel-registry.sh'; then
    echo "ok   - the hook is registered under PostToolUse, not another event"
  else
    echo "FAIL - check-panel-registry.sh is named in builder.md but not under PostToolUse"
    FAILURES=$((FAILURES + 1))
  fi
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All check-panel-registry.sh tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
