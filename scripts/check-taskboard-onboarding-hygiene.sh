#!/usr/bin/env bash
# Tripwire: fail the PR if a stale taskboard onboarding FACT that the
# agentic-sync generator cannot reach reappears in a contributor-facing file.
#
# WHY
# The taskboard's project/team IDs were rotated, and the runbook forbids the
# `--db` start flag. Two classes of stale fact lingered across ~18
# contributor-facing files (provider rules, kanban skills, README, CONTRIBUTING)
# and two functional hooks, onboarding non-Claude contributors against a broken
# board:
#   (1) STALE-ID    — a dead project/team ULID. The board-summary hook silently
#                     filtered to a dead project and reported zero work; a Codex/
#                     Gemini/Windsurf/Antigravity contributor created tickets
#                     against IDs that 404.
#   (2) FORBIDDEN-DB — a `taskboard start ... --db .claude/taskboard.db` command.
#                     Passing --db creates an EMPTY local DB copy, so the board
#                     shows 0 tickets. The OS-default path is the source of truth;
#                     the runbook says NEVER pass --db.
#
# The agentic-sync generator keeps the canonical FACTS BLOCK in sync across the 4
# primary onboarding files, but it cannot reach a fact embedded inline in a curl
# command, a markdown table row, a code fence, or a non-target provider file
# (.windsurf, .agent, .agents). This is the negative guard the parity review
# called for: grep the whole tree, fail on either stale fact, anywhere, in any
# file type.
#
# ALLOWLIST — the only legitimate homes for a stale fact, as DATA:
#   * docs/reviews/2026-06-02-agentic-toolkit-parity-review.md — the review that
#     DOCUMENTS the staleness, quoting the dead IDs as its finding.
#   * .claude/hooks/github-sync-config.json — its `legacyProjectIds` array is the
#     intentional old->new mapping. ONLY the dead PROJECT id is allowed there;
#     a dead TEAM id has no legacy home and still trips the gate.
#
# Mirrors scripts/check-lockfile-sync.sh / check-agentic-sync.sh: a self-contained
# ~1s check, wired into the required ci-success aggregate, anti-tamper-guarded,
# and unit-tested by scripts/__tests__/check-taskboard-onboarding-hygiene.test.sh.
# It is a CHECK, not a fix — it never mutates a file.
#
# TEST SEAM (never set in CI): STALE_ID_SCAN_ROOT overrides the scan root so the
# hermetic suite can point it at a fixture tree instead of the repo.
set -uo pipefail

ROOT="${STALE_ID_SCAN_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT" || { echo "::error::could not cd to scan root: $ROOT"; exit 1; }

# The four known-dead taskboard ULIDs. DEAD_PROJECT is the legacy project id that
# legitimately survives in github-sync-config.json's legacyProjectIds array; the
# three team ids have no legitimate home anywhere.
DEAD_PROJECT="01KK974VMNC16ZAW7MW1NH3T3M"
DEAD_IDS=(
  "$DEAD_PROJECT"
  "01KK9751NZ4HM7VQM0AQ5WGME3"
  "01KK9751P7GKQYG9TZ96XXQCFN"
  "01KK9751PD79RCWY462CYQ06CW"
)

# Forbidden start invocation: `taskboard start` ... `--db .claude/taskboard.db`.
# The path argument is REQUIRED in the pattern (and must follow `taskboard start`
# on the same line), so the many legitimate WARNINGS never trip:
#   "taskboard start --port 3010    # NO --db flag"   (no path after --db)
#   "NEVER pass `--db .claude/taskboard.db`"          (no `taskboard start`)
#   "never pass `--db ...` to `taskboard start`"      (reversed order)
# Both the space and `=` separators are matched.
FORBIDDEN_DB_RE='taskboard start.*--db[[:space:]=]+\.claude/taskboard\.db'

ALLOW_DOC="docs/reviews/2026-06-02-agentic-toolkit-parity-review.md"
ALLOW_CFG=".claude/hooks/github-sync-config.json"

# This tripwire's own two files name the dead ids / forbidden command as data, so
# they are excluded by basename and never self-trip.
GUARD_BASENAME="check-taskboard-onboarding-hygiene.sh"
TEST_BASENAME="check-taskboard-onboarding-hygiene.test.sh"

# Shared excludes. -I skips binaries; build/vendor dirs and the tripwire's own
# files are excluded.
common_excludes=(
  --exclude-dir=.git
  --exclude-dir=node_modules
  --exclude-dir=dist
  --exclude-dir=build
  --exclude-dir=.next
  --exclude-dir=target
  --exclude-dir=.turbo
  --exclude="$GUARD_BASENAME"
  --exclude="$TEST_BASENAME"
)

# --- Scan 1: dead ULIDs (fixed-string, line-numbered, recursive) -------------
grep_args=()
for id in "${DEAD_IDS[@]}"; do
  grep_args+=(-e "$id")
done
id_matches="$(grep -rnI -F "${common_excludes[@]}" "${grep_args[@]}" . 2>/dev/null)"

# --- Scan 2: forbidden `taskboard start ... --db <path>` invocation ----------
db_matches="$(grep -rnIE "${common_excludes[@]}" "$FORBIDDEN_DB_RE" . 2>/dev/null)"

offenders=()

# Stale-ID offenders, with the two-home allowlist.
while IFS= read -r line; do
  [ -z "$line" ] && continue
  file="${line%%:*}"
  file="${file#./}"

  # Allowlist 1: the parity-review doc documents the staleness wholesale.
  if [ "$file" = "$ALLOW_DOC" ]; then
    continue
  fi

  # Allowlist 2: github-sync-config.json may carry the dead PROJECT id in its
  # legacyProjectIds mapping. Remove that one allowed id, then re-check: if ANY
  # dead id still remains on the line, it is a real offender (a dead TEAM id, or
  # a second project occurrence), so it is NOT masked by the project-id allowance.
  if [ "$file" = "$ALLOW_CFG" ]; then
    stripped="${line//"$DEAD_PROJECT"/}"
    still_dead=0
    for id in "${DEAD_IDS[@]}"; do
      case "$stripped" in
        *"$id"*) still_dead=1; break ;;
      esac
    done
    if [ "$still_dead" -eq 0 ]; then
      continue
    fi
  fi

  offenders+=("STALE-ID      $line")
done <<< "$id_matches"

# Forbidden---db offenders. The review doc is the only documentation home.
while IFS= read -r line; do
  [ -z "$line" ] && continue
  file="${line%%:*}"
  file="${file#./}"
  if [ "$file" = "$ALLOW_DOC" ]; then
    continue
  fi
  offenders+=("FORBIDDEN-DB  $line")
done <<< "$db_matches"

if [ "${#offenders[@]}" -gt 0 ]; then
  echo "::error::Stale taskboard onboarding fact(s) found — they break onboarding parity and automation:"
  for o in "${offenders[@]}"; do
    echo "  - $o"
  done
  echo ""
  echo "STALE-ID — a rotated project/team ULID. Replace each with the LIVE id"
  echo "(source of truth: tools/agentic-sync/canonical.json):"
  echo "    Project (Project Forge, prefix PF): 01KMM9ZA6SBZ7RKJZJTZS9VR4R"
  echo "    Engineering team:                   01KMR5E36TP59PRQA8GQEWJVM1"
  echo "    PM team:                            01KMR5E3852BWXAZ219W47CSKS"
  echo "(There is no live 'Leadership' team — remove that reference entirely.)"
  echo ""
  echo "FORBIDDEN-DB — a 'taskboard start ... --db .claude/taskboard.db' command."
  echo "Drop the --db flag: 'taskboard start --port 3010'. The OS-default DB is"
  echo "the source of truth; passing --db creates an empty copy (board shows 0)."
  echo ""
  echo "The only allowed home for these as data is the parity-review doc; the dead"
  echo "PROJECT id may also live in legacyProjectIds of $ALLOW_CFG."
  exit 1
fi

echo "✓ No stale taskboard IDs or forbidden --db start commands found (scanned $ROOT)."
exit 0
