#!/usr/bin/env bash
# PostToolUse hook: run the panelRegistry suite whenever panelRegistry.ts is edited.
#
# WHY THIS EXISTS (PF-957 / #8939)
# --------------------------------
# Inserting into `panelRegistry.ts` is the single most repeated agent bug in this
# repo — 21 recorded instances. The mitigation up to now was prose ("read ten
# lines either side, run the test after editing"), which the harness capability
# audit classified as DOCUMENTED-ONLY. Prose is not a control: a cheaper model
# under time pressure skips it, and the resulting break is invisible until some
# later run of the full suite. This turns the prose into a mechanism that fires
# on the edit itself.
#
# EXIT CODES ARE THE CONTRACT
#   0  the edited path is not panelRegistry.ts, or it is and the suite passed
#   2  the suite failed, OR the suite could not be run at all
#
# The second half of that matters more than it looks. A guard that exits 0 when
# it cannot run is worse than no guard: it reports "clean" for every edit after
# the toolchain moves, and nobody notices because the output looks identical to
# a pass. So every path where the verdict is unknown — no repo root, no `npx`,
# missing test file — is a BLOCK with a message naming the reason.
#
# NO TEST-ONLY SEAMS. The suite drives this hook entirely through
# `TOOL_INPUT_file_path`, the working directory, and `$PATH` (a stub `npx`), so
# there is no env override in here that CI could set to neuter it — which is why
# this file needs none of the anti-tamper machinery `.claude/rules/hook-testing.md`
# requires of a hook carrying a fixture seam.
set -uo pipefail

FILE_PATH="${TOOL_INPUT_file_path:-}"

# Windows tool inputs arrive with backslashes; compare in one separator.
NORMALISED="${FILE_PATH//\\//}"

TARGET='web/src/lib/workspace/panelRegistry.ts'
REL_TEST='src/lib/workspace/__tests__/panelRegistry.test.ts'

# Non-matching paths exit FIRST, before any git or filesystem work, so the
# common case costs a string comparison rather than a subprocess.
case "$NORMALISED" in
  "$TARGET" | */"$TARGET") ;;
  *) exit 0 ;;
esac

block() {
  echo "BLOCKED: panelRegistry guard could not confirm the registry is intact." >&2
  echo "  $1" >&2
  echo "" >&2
  echo "  Registry insertion is the #1 recurring bug here (21 instances), so an" >&2
  echo "  unverifiable edit is treated as a failed one. Fix the cause above and" >&2
  echo "  re-run: cd web && npx vitest run $REL_TEST" >&2
  exit 2
}

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$REPO_ROOT" ] || block "not inside a git repository, so the web/ directory cannot be located."
[ -d "$REPO_ROOT/web" ] || block "no web/ directory under $REPO_ROOT."
[ -f "$REPO_ROOT/web/$REL_TEST" ] || block "the suite $REL_TEST is missing — the guard has nothing to run."
command -v npx >/dev/null 2>&1 || block "npx is not on PATH, so the suite cannot be run."

OUTPUT="$(cd "$REPO_ROOT/web" && npx vitest run "$REL_TEST" 2>&1)"
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  echo "BLOCKED: panelRegistry.ts was edited and its suite now fails." >&2
  echo "" >&2
  echo "$OUTPUT" >&2
  echo "" >&2
  echo "  Registry entries are order- and shape-sensitive; an insertion that looks" >&2
  echo "  right often is not. Re-read the entries either side of yours." >&2
  exit 2
fi

echo "panelRegistry suite passed."
exit 0
