#!/usr/bin/env bash
# Tests for scripts/check-symlinks.sh — the gate that every path git records as
# a symlink (mode 120000) is a REAL symlink in the working tree and resolves to
# something git tracks inside the repository.
#
# Hermetic: each case builds a throwaway git repository. Fixtures need real
# symlinks, so on Windows (Git Bash) MSYS is told to create native ones; a host
# that cannot create symlinks fails this suite instead of skipping it, because
# this repository requires symlinks and a host without them is the defect the
# gate exists to catch (lessons-learned #9).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$HERE/../check-symlinks.sh"
[ -f "$GATE" ] || { echo "FAIL gate not found: $GATE"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "FAIL git is required"; exit 1; }
export MSYS=winsymlinks:nativestrict

pass=0
fail=0
ok()  { echo "  PASS: $1"; pass=$((pass + 1)); }
readonly -f ok
bad() { echo "  FAIL: $1"; fail=$((fail + 1)); }
readonly -f bad

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Probe: can this host create a symlink at all?
mkdir -p "$TMP/probe" && : > "$TMP/probe/t" && ln -s t "$TMP/probe/l" 2>/dev/null
if [ ! -L "$TMP/probe/l" ]; then
  echo "FAIL this host cannot create symlinks (on Windows: enable Developer Mode)."
  exit 1
fi

# repo <name> — a fresh repository with symlinks enabled and one tracked target
# file plus one tracked target directory.
repo() {
  local d="$TMP/$1"
  mkdir -p "$d/shared/dir" "$d/links"
  git -C "$d" init -q
  git -C "$d" config user.email fixture@example.invalid
  git -C "$d" config user.name fixture
  git -C "$d" config core.symlinks true
  git -C "$d" config core.autocrlf false
  printf 'TARGET\n' > "$d/shared/file.md"
  printf 'IN DIR\n' > "$d/shared/dir/SKILL.md"
  echo "$d"
}
readonly -f repo

# commit_all <repo>
commit_all() { git -C "$1" add -A && git -C "$1" commit -qm fixture; }
readonly -f commit_all

# run_gate <repo> — prints "<exit>|<output>", running from a subdirectory to
# prove the gate finds the repository root itself.
run_gate() {
  local out rc
  out="$(cd "$1/links" && bash "$GATE" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}
readonly -f run_gate

# expect <case> <result> <want-exit> <needle>... — "~needle" must be absent.
expect() {
  local desc="$1" res="$2" want="$3"; shift 3
  local rc="${res%%|*}" out="${res#*|}" needle good=1
  if [ "$rc" != "$want" ]; then
    bad "$desc — expected exit $want, got $rc: $out"
    return
  fi
  for needle in "$@"; do
    case "$needle" in
      "~"*) if grep -qF -- "${needle#\~}" <<<"$out"; then bad "$desc — output must not contain '${needle#\~}'"; good=0; fi ;;
      *)  if ! grep -qF -- "$needle" <<<"$out"; then bad "$desc — output lacks '$needle': $out"; good=0; fi ;;
    esac
  done
  [ "$good" -eq 1 ] && ok "$desc"
}
readonly -f expect

echo "=== check-symlinks.sh tests ==="

# ---- 1. healthy: a file link and a directory link both resolve --------------
R="$(repo healthy)"
ln -s ../shared/file.md "$R/links/file.md"
ln -s ../shared/dir "$R/links/dir"
commit_all "$R"
expect "1. real symlinks to tracked targets pass" "$(run_gate "$R")" 0 "2 symlinks OK"

# ---- 2. a stub: recorded as a symlink, checked out as a regular file --------
# This is exactly a core.symlinks=false checkout. Build it by recording the
# index entry by hand and leaving the working-tree file regular.
R="$(repo stub)"
ln -s ../shared/file.md "$R/links/good.md"
printf '../shared/dir' > "$R/links/stub"
commit_all "$R"
blob="$(git -C "$R" hash-object -w "$R/links/stub")"
git -C "$R" update-index --cacheinfo "120000,$blob,links/stub"
git -C "$R" config core.symlinks false
expect "2. a symlink checked out as a text stub fails and names the path" \
  "$(run_gate "$R")" 1 "links/stub" "core.symlinks true" "~links/good.md"

# ---- 3. dangling: the target does not exist ---------------------------------
R="$(repo dangling)"
ln -s ../shared/file.md "$R/links/ok.md"
ln -s ../shared/missing.md "$R/links/gone.md"
commit_all "$R"
expect "3. a link whose target does not exist fails" "$(run_gate "$R")" 1 "links/gone.md" "does not resolve"

# ---- 4. absolute target -------------------------------------------------------
R="$(repo absolute)"
ln -s "$R/shared/file.md" "$R/links/abs.md"
commit_all "$R"
expect "4. a link with an absolute target fails" "$(run_gate "$R")" 1 "links/abs.md" "absolute"

# ---- 5. escapes the repository ------------------------------------------------
R="$(repo escape)"
printf 'OUTSIDE\n' > "$TMP/outside.md"
ln -s ../../outside.md "$R/links/out.md"
commit_all "$R"
expect "5. a link that resolves outside the repository fails" "$(run_gate "$R")" 1 "links/out.md" "outside the repository"

# ---- 6. untracked target (would not exist in a fresh clone) -----------------
R="$(repo untracked)"
printf 'local only\n' > "$R/shared/local.md"
printf 'shared/local.md\n' > "$R/.gitignore"
ln -s ../shared/local.md "$R/links/local.md"
commit_all "$R"
expect "6. a link to a file git does not track fails" "$(run_gate "$R")" 1 "links/local.md" "not tracked"

# ---- 7. vacuous: no symlinks recorded at all --------------------------------
R="$(repo empty)"
commit_all "$R"
expect "7. a repository with no recorded symlinks fails rather than passing vacuously" \
  "$(run_gate "$R")" 1 "no symlinks"

# ---- 8. not a git work tree -------------------------------------------------
mkdir -p "$TMP/norepo/links"
expect "8. outside a git work tree exits 2" "$(run_gate "$TMP/norepo")" 2 "not inside a git work tree"

# ---- 9. paths with spaces survive the -z parsing ------------------------------
R="$(repo spaces)"
ln -s "../shared/file.md" "$R/links/with space.md"
commit_all "$R"
expect "9. a link path containing a space is checked, not split" "$(run_gate "$R")" 0 "1 symlinks OK"

echo ""
echo "=== $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]
