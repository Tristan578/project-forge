#!/usr/bin/env bash
#
# Unit test for scripts/check-skills.sh — the skill best-practices linter.
#
# Drives the linter through its real contract against a TEMP skills tree (via the
# $SKILLS_DIR / $SKILLS_BASELINE_FILE test-only seams), asserting on exit codes
# and emitted ::error/::warning lines. Exit 0 = lint pass, exit 1 = a
# non-baselined finding — those two codes ARE the behavior, so we assert on them
# directly. Self-contained (no bats); exits non-zero if any case fails.
#
# Run:  bash scripts/__tests__/check-skills.test.sh
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
linter="$repo_root/scripts/check-skills.sh"

command -v awk >/dev/null 2>&1 || { echo "awk required"; exit 1; }
[ -f "$linter" ] || { echo "linter not found at $linter"; exit 1; }

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILED=1; }
FAILED=0

# Scratch tree, cleaned on exit.
work="$(mktemp -d -t check-skills-test.XXXXXX)"
trap 'rm -f "$out"; rm -rf "$work"' EXIT
out="$(mktemp)"

# mkskill <dir> <name-value> <description> [body]
# Writes a minimal SKILL.md under $work/<dir>.
mkskill() {
  local dir="$1" name="$2" desc="$3" body="${4:-Body content for the skill.}"
  mkdir -p "$work/$dir"
  {
    echo "---"
    echo "name: $name"
    echo "description: $desc"
    echo "---"
    echo ""
    echo "$body"
  } > "$work/$dir/SKILL.md"
}

# run_lint [args...] — run the linter against the temp tree, capture stdout+stderr
# in $out, echo the exit code. No baseline unless a test sets one.
run_lint() {
  SKILLS_DIR="$work" SKILLS_BASELINE_FILE="${BASELINE:-/dev/null}" \
    bash "$linter" "$@" >"$out" 2>&1
  echo $?
}

reset_tree() { rm -rf "$work"; mkdir -p "$work"; BASELINE=""; }

# --- 1. A fully valid skill passes (exit 0) -----------------------------------
reset_tree
mkskill good-skill good-skill "A clear description of when to use this skill, well over twenty chars."
rc="$(run_lint good-skill)"
if [ "$rc" = "0" ]; then pass "a valid skill passes (exit 0)"; else fail "valid skill should exit 0, got $rc"; cat "$out"; fi

# --- 2. name != directory fails (exit 1) --------------------------------------
reset_tree
mkskill mismatch wrong-name "A description that is plenty long enough to satisfy the minimum length."
rc="$(run_lint mismatch)"
if [ "$rc" = "1" ]; then pass "name != dir fails (exit 1)"; else fail "name mismatch should exit 1, got $rc"; fi
if grep -q "must equal the directory name" "$out"; then pass "name-mismatch message is emitted"; else fail "name-mismatch message missing"; fi
if grep -q "::error" "$out"; then pass "a non-baselined finding is an ::error"; else fail "expected ::error annotation"; fi

# --- 3. non-kebab-case name fails ---------------------------------------------
reset_tree
mkskill Bad_Name Bad_Name "A description that is plenty long enough to satisfy the minimum length."
rc="$(run_lint Bad_Name)"
if [ "$rc" = "1" ]; then pass "non-kebab name fails (exit 1)"; else fail "non-kebab name should exit 1, got $rc"; fi
if grep -q "kebab-case" "$out"; then pass "kebab-case message is emitted"; else fail "kebab-case message missing"; fi

# --- 4. missing description fails ---------------------------------------------
reset_tree
mkdir -p "$work/no-desc"
printf '%s\n' "---" "name: no-desc" "---" "" "Body." > "$work/no-desc/SKILL.md"
rc="$(run_lint no-desc)"
if [ "$rc" = "1" ]; then pass "missing description fails (exit 1)"; else fail "missing description should exit 1, got $rc"; fi
if grep -q "missing a non-empty 'description:'" "$out"; then pass "missing-description message is emitted"; else fail "missing-description message missing"; fi

# --- 5. too-short description fails (boundary: 19 chars) -----------------------
reset_tree
mkskill short short "Nineteen chars now"   # 18 chars, < 20
rc="$(run_lint short)"
if [ "$rc" = "1" ]; then pass "too-short description fails (exit 1)"; else fail "short description should exit 1, got $rc"; fi

# --- 6. frontmatter not on line 1 fails ---------------------------------------
reset_tree
mkdir -p "$work/late-fm"
printf '%s\n' "" "---" "name: late-fm" "description: long enough description for the minimum length check here." "---" "Body." > "$work/late-fm/SKILL.md"
rc="$(run_lint late-fm)"
if [ "$rc" = "1" ]; then pass "frontmatter not on line 1 fails (exit 1)"; else fail "late frontmatter should exit 1, got $rc"; fi
if grep -q "must start on line 1" "$out"; then pass "line-1 frontmatter message is emitted"; else fail "line-1 message missing"; fi

# --- 7. broken relative link fails --------------------------------------------
reset_tree
mkskill brokenlink brokenlink "A description that is plenty long enough to satisfy the minimum length." \
  "See [the guide](references/missing.md) for details."
rc="$(run_lint brokenlink)"
if [ "$rc" = "1" ]; then pass "broken relative link fails (exit 1)"; else fail "broken link should exit 1, got $rc"; fi
if grep -q "broken link" "$out"; then pass "broken-link message is emitted"; else fail "broken-link message missing"; fi

# --- 8. a resolvable relative link passes -------------------------------------
reset_tree
mkskill oklink oklink "A description that is plenty long enough to satisfy the minimum length." \
  "See [the guide](references/guide.md) for details."
mkdir -p "$work/oklink/references"; echo "guide" > "$work/oklink/references/guide.md"
rc="$(run_lint oklink)"
if [ "$rc" = "0" ]; then pass "resolvable link passes (exit 0)"; else fail "resolvable link should exit 0, got $rc"; cat "$out"; fi

# --- 9. links inside fenced code blocks are NOT treated as links --------------
reset_tree
mkskill codefence codefence "A description that is plenty long enough to satisfy the minimum length." \
  "$(printf '%s\n' 'Example:' '```' 'const x = arr[0](nope.md)' '```' 'Done.')"
rc="$(run_lint codefence)"
if [ "$rc" = "0" ]; then pass "code-fenced pseudo-link is ignored (exit 0)"; else fail "code-fence false positive, got $rc"; cat "$out"; fi

# --- 10. missing SKILL.md fails -----------------------------------------------
reset_tree
mkdir -p "$work/empty-dir"
rc="$(run_lint empty-dir)"
if [ "$rc" = "1" ]; then pass "missing SKILL.md fails (exit 1)"; else fail "missing SKILL.md should exit 1, got $rc"; fi
if grep -q "missing SKILL.md" "$out"; then pass "missing-SKILL.md message is emitted"; else fail "missing-SKILL.md message missing"; fi

# --- 11. RATCHET: a baselined skill with a finding is a warning, not a failure -
reset_tree
mkskill legacy-skill wrong-name "A description that is plenty long enough to satisfy the minimum length."
BASELINE="$work/baseline.txt"; printf '%s\n' "# known debt" "legacy-skill" > "$BASELINE"
rc="$(run_lint legacy-skill)"
if [ "$rc" = "0" ]; then pass "baselined finding does NOT fail (exit 0)"; else fail "baselined finding should exit 0, got $rc"; cat "$out"; fi
if grep -q "::warning" "$out" && grep -q "baselined: legacy-skill" "$out"; then pass "baselined finding is downgraded to ::warning"; else fail "expected baselined ::warning"; fi
if grep -q "::error" "$out"; then fail "baselined finding must not emit ::error"; else pass "no ::error for baselined finding"; fi

# --- 12. RATCHET MIX: a clean non-baselined skill + a dirty baselined skill ----
# The baselined one warns; the clean one is silent; overall passes. Proves the
# ratchet only waives the listed skill, not the whole run.
reset_tree
mkskill legacy-skill wrong-name "A description that is plenty long enough to satisfy the minimum length."
mkskill clean-skill clean-skill "A description that is plenty long enough to satisfy the minimum length."
BASELINE="$work/baseline.txt"; printf '%s\n' "legacy-skill" > "$BASELINE"
rc="$(run_lint)"   # lint ALL skills in the temp tree
if [ "$rc" = "0" ]; then pass "ratchet mix (1 baselined dirty + 1 clean) passes (exit 0)"; else fail "ratchet mix should exit 0, got $rc"; cat "$out"; fi

# --- 13. ANTI-ROT: a baselined skill that now lints CLEAN warns to prune -------
reset_tree
mkskill reformed reformed "A description that is plenty long enough to satisfy the minimum length."
BASELINE="$work/baseline.txt"; printf '%s\n' "reformed" > "$BASELINE"
rc="$(run_lint reformed)"
if [ "$rc" = "0" ]; then pass "clean baselined skill passes (exit 0)"; else fail "clean baselined skill should exit 0, got $rc"; fi
if grep -q "now lints clean" "$out"; then pass "anti-rot prune warning is emitted"; else fail "anti-rot prune warning missing"; fi

# --- 14. SCOPED run does NOT false-warn anti-rot for un-checked baselined skills
# A scoped run that evaluates only 'reformed' must NOT claim the OTHER baselined
# skill ('untouched', not in this run) is clean — it never looked at it.
reset_tree
mkskill reformed reformed "A description that is plenty long enough to satisfy the minimum length."
mkdir -p "$work/untouched"   # exists but is NOT linted this run
BASELINE="$work/baseline.txt"; printf '%s\n' "reformed" "untouched" > "$BASELINE"
rc="$(run_lint reformed)"
if grep -q "baselined skill 'untouched' now lints clean" "$out"; then fail "scoped run false-warned for un-checked 'untouched'"; else pass "scoped run does not false-warn un-checked baselined skills"; fi

# --- 15. empty skills dir → nothing to lint, exit 0 ---------------------------
reset_tree
rc="$(run_lint)"
if [ "$rc" = "0" ]; then pass "empty skills tree passes (exit 0, nothing to lint)"; else fail "empty tree should exit 0, got $rc"; fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "All check-skills tests passed."
  exit 0
else
  echo "Some check-skills tests FAILED."
  exit 1
fi
