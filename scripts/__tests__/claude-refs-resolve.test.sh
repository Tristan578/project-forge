#!/usr/bin/env bash
# Every file path referenced by the agent harness must actually exist.
#
# WHY THIS EXISTS (#9605)
#
# `.claude/hooks/inject-lessons-learned.sh` — a wired PreToolUse hook that eight
# subagents are told to rely on, and whose own header calls it "the CRITICAL
# enforcement mechanism" — read its lessons file from
#
#   $HOME/.claude/projects/-Users-tristannolan-project-forge/memory/...
#
# an absolute path containing one machine's username. On every other machine it
# resolved to nothing, the hook took a silent `exit 0`, and NO anti-patterns
# were injected for entire sessions. Sixteen files pointed at that path. The
# hook's own test suite skipped the one check that would have caught it and
# printed "All tests passed".
#
# A dangling reference in agent instructions fails the same way a dangling
# import never could: nothing errors. The agent simply reads nothing and carries
# on. So the references are checked as a build artifact, like any other link.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${CLAUDE_REFS_ROOT:-$(cd "$HERE/../.." && pwd)}"

PASS=0
FAIL=0
pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

if [ ! -d "$ROOT/.claude" ]; then
  echo "  FAIL: no .claude directory under $ROOT"
  echo "SUITE FAILED"
  exit 1
fi

echo "=== the lessons file the enforcement hook depends on ==="

LESSONS="$ROOT/.claude/rules/lessons-learned.md"
if [ -f "$LESSONS" ]; then
  pass "the canonical lessons file exists at .claude/rules/lessons-learned.md"
else
  fail "no .claude/rules/lessons-learned.md — inject-lessons-learned.sh injects NOTHING in this state, silently (#9605)"
fi

# The hook must not reach for a machine-specific absolute path again.
HOOK="$ROOT/.claude/hooks/inject-lessons-learned.sh"
if [ -f "$HOOK" ]; then
  # A username in a resolution path is the exact defect. The legacy fallback is
  # allowed only as a GLOB (`projects/*/memory`), which names no machine.
  # Comment lines are stripped first: the hook documents the retired path to
  # explain why the resolution changed, and that prose must not read as a
  # relapse. Only executable lines are checked.
  # shellcheck disable=SC2016  # the $HOME here is a literal being searched for
  if sed 's/[[:space:]]*#.*//' "$HOOK" | grep -qE '\$HOME/\.claude/projects/-[A-Za-z]'; then
    fail "inject-lessons-learned.sh still resolves a path containing a hardcoded username — that is what made it a no-op on every other machine"
  else
    pass "inject-lessons-learned.sh resolves no hardcoded username"
  fi
  if grep -q 'LESSONS HOOK DISABLED' "$HOOK"; then
    pass "a missing lessons file is announced, not silent"
  else
    fail "inject-lessons-learned.sh has no loud path for a missing lessons file — silence there is what hid a session-long outage"
  fi
else
  fail "inject-lessons-learned.sh not found"
fi

echo ""
echo "=== no harness file may reference the retired path ==="
# The hook and the lessons file both describe the migration, so both legitimately
# name the old file. Nothing else may.
# Only files git TRACKS. github_project_sync.py writes an untracked
# github-project-map.json cache under .claude/hooks/, and GitHub issue titles
# mirrored into it name the retired path verbatim. Letting an untracked local
# artifact decide this result reproduces #9605's own defect: harness behaviour
# that differs per machine. It also makes the suite unfixable — green in CI,
# where the cache does not exist, and red locally for reasons no commit can
# address.
TRACKED="$(git -C "$ROOT" ls-files -- '.claude/*' 2>/dev/null || true)"
if [ -z "$TRACKED" ]; then
  fail "git tracks no files under .claude/ — this sweep would pass vacuously"
else
  STALE="$(printf '%s\n' "$TRACKED" \
    | grep -v 'inject-lessons-learned.sh' \
    | grep -v 'rules/lessons-learned.md' \
    | while IFS= read -r f; do
        if [ -f "$ROOT/$f" ] && grep -q 'project_lessons_learned' "$ROOT/$f"; then
          echo "$f"
        fi
      done)"
  if [ -z "$STALE" ]; then
    pass "no tracked file points at the retired project_lessons_learned.md"
  else
    fail "these still reference the retired path, and read nothing at runtime:"
    printf '%s\n' "$STALE" | sed 's|^|    |'
  fi
fi

echo ""
echo "=== every .claude/rules/*.md referenced by the harness exists ==="
# Agents and skills cite rules files by name. A citation for a file that does not
# exist sends the agent looking for guidance it will never find.
#
# TRACKED files only, for the same reason the retired-path sweep above uses
# them: `.claude/*` is gitignored with a narrow whitelist, so a working-tree
# grep also reads a developer's local scratch -- a `/skill-doctor` backup file
# naming paths under `.claude/skills/` was enough to make this sweep report four
# dangling references that do not exist in the repository.
missing=0
checked=0
while IFS= read -r ref; do
  [ -n "$ref" ] || continue
  checked=$((checked + 1))
  if [ ! -f "$ROOT/$ref" ]; then
    fail "referenced but missing: $ref"
    missing=$((missing + 1))
  fi
done < <(git -C "$ROOT" ls-files -z .claude 2>/dev/null \
  | (cd "$ROOT" && xargs -0 grep -hoE '\.claude/rules/[a-z0-9-]+\.md' 2>/dev/null) \
  | sort -u)

if [ "$checked" -eq 0 ]; then
  fail "no .claude/rules/*.md references found at all — the extractor is broken, and this rule would pass vacuously"
elif [ "$missing" -eq 0 ]; then
  pass "all ${checked} referenced rules file(s) exist"
fi

echo ""
echo "=== every .claude/skills/... path referenced by the harness exists ==="
# This file's header claims EVERY harness path is checked; for its whole life it
# checked only .claude/rules/*.md. The skills tree was the uncovered half, and it
# was where the damage was: dx-guardian.md and ux-reviewer.md named eight skills
# that were never created and told the reviewer to run ten audit scripts and read
# five reference docs under them. A reviewer following those instructions reported
# "no findings" from commands that had all failed to run — the #9605 failure mode
# exactly, in the directory this rule did not look at.
#
# Directories count as resolved: an agent's `skills:` frontmatter names a skill by
# directory, while prose cites files inside it. Placeholder forms in docs
# (`.claude/skills/<name>/`, `.claude/skills/*/SKILL.md`, `.claude/skills/$s`) do
# not match the extractor, which requires a literal path character after the
# prefix — so they are neither checked nor falsely reported.
missing=0
checked=0
while IFS= read -r ref; do
  [ -n "$ref" ] || continue
  checked=$((checked + 1))
  if [ ! -e "$ROOT/$ref" ]; then
    fail "referenced but missing: $ref"
    missing=$((missing + 1))
  fi
done < <(git -C "$ROOT" ls-files -z .claude 2>/dev/null \
  | (cd "$ROOT" && xargs -0 grep -hoE '\.claude/skills/[a-zA-Z0-9._-]+(/[a-zA-Z0-9._-]+)*' 2>/dev/null) \
  | sed 's/[.,`)]*$//' | sort -u)

if [ "$checked" -eq 0 ]; then
  fail "no .claude/skills/* references found at all — the extractor is broken, and this rule would pass vacuously"
elif [ "$missing" -eq 0 ]; then
  pass "all ${checked} referenced skills path(s) exist"
fi

echo ""
echo "  PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "SUITE PASSED"
  exit 0
fi
echo "SUITE FAILED"
exit 1
