#!/usr/bin/env bash
# Decision-logic tests for scripts/check-portable-paths.sh.
#
# Hermetic: each case builds a throwaway git repo, writes fixtures into it, and
# runs the gate from inside. The gate reads `git ls-files` relative to whatever
# repo it is standing in, so the only seam it needs is PORTABLE_PATHS_MIN_FILES,
# which lowers the "the walk is broken" floor from 500 to something a fixture
# repo can reach. The suite asserts no workflow sets it: wiring it in CI would
# let a broken walk pass as a clean one, which is the failure the floor exists
# to catch.
#
# THE CASE THAT MATTERS. The allowlist is matched against the FILE PATH, never
# the `path:line:content` string grep emits. The first version matched the whole
# string, which broke it in both directions at once: every `$`-anchored entry
# became unreachable (so the gate failed on its own header comment and on
# .gitignore), and every unanchored entry over-matched (so ANY file was exempt
# on ANY line whose content happened to say `mockOnceGuard`). Four cases below
# pin those two directions; they fail on the pre-fix script.
#
# This suite writes the forbidden path shapes it tests with. It is on the gate's
# own allowlist for that reason — the same exemption the gate script has.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/check-portable-paths.sh"
PASS=0
FAIL=0

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Assembled at runtime rather than written as literals, so this file does not
# ship strings that read as real machine-local paths to anything scanning it.
WIN_PATH="D:${SLASH:-/}repos${SLASH:-/}into-rust${SLASH:-/}tool.exe"
MAC_PATH="/Users/somebody/project-forge"
LINUX_PATH="/home/somebody/project-forge"
RUNNER_PATH="/home/runner/work/project-forge"

# make_repo <name> — a git repo with `pad` filler files, so a case can choose a
# tracked-file count independently of the fixtures it cares about.
make_repo() {
  # Separate `local` statements on purpose: every argument to one `local` is
  # word-expanded BEFORE any of them is assigned, so `dir="$TMP/$name"` on the
  # same line reads an unset `name` and aborts under `set -u`.
  local name="$1"
  local pad="${2:-5}"
  local dir="$TMP/$name"
  local i
  rm -rf "$dir"
  mkdir -p "$dir"
  (
    cd "$dir" || exit 1
    git init -q .
    git config user.email t@example.com
    git config user.name t
    i=0
    while [ "$i" -lt "$pad" ]; do
      printf 'filler\n' > "pad-$i.txt"
      i=$((i + 1))
    done
  ) >/dev/null 2>&1
  printf '%s' "$dir"
}

# add_file <repo> <relative path> <content>
add_file() {
  local dir="$1" rel="$2" body="$3"
  mkdir -p "$dir/$(dirname "$rel")"
  printf '%s\n' "$body" > "$dir/$rel"
}

# run_case <name> <expected exit> <repo dir> [min files]
run_case() {
  local name="$1" expected="$2" dir="$3" min="${4:-3}" out status
  (cd "$dir" && git add -A) >/dev/null 2>&1
  out="$(cd "$dir" && PORTABLE_PATHS_MIN_FILES="$min" bash "$SCRIPT" 2>&1)"
  status=$?
  if [ "$status" -eq "$expected" ]; then
    PASS=$((PASS + 1))
    echo "  ok   $name (exit $status)"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL $name: expected exit $expected, got $status"
    echo "$out" | sed 's/^/         /' | head -6
  fi
}

echo "check-portable-paths decision logic"

# --- the four forbidden shapes, and the one portable one ---

d="$(make_repo clean)"
run_case "a repo with no machine-local paths passes" 0 "$d"

d="$(make_repo windows)"
add_file "$d" "src/config.toml" "command = \"$WIN_PATH\""
run_case "a Windows drive-letter repo path fails" 1 "$d"

d="$(make_repo mac)"
add_file "$d" "docs/setup.md" "Run it from $MAC_PATH first."
run_case "a macOS home directory fails" 1 "$d"

d="$(make_repo linux)"
add_file "$d" "docs/setup.md" "Run it from $LINUX_PATH first."
run_case "a Linux home directory fails" 1 "$d"

d="$(make_repo runner)"
add_file "$d" ".github/workflows/x.yml" "  path: $RUNNER_PATH/cache"
run_case "the GitHub Actions HOME is portable and passes" 0 "$d"

# A file may hold both. Filtering /home/runner/ by LINE, not by dropping it from
# the pattern, is what keeps the real path visible in a file that also has one.
d="$(make_repo mixed)"
add_file "$d" ".github/workflows/x.yml" "  cache: $RUNNER_PATH
  home: $LINUX_PATH"
run_case "a real home path in a file that also has the runner's still fails" 1 "$d"

# --- the allowlist: matched against the path, not the whole grep line ---

# Anchored entries. Both of these pass on a `path:line:content` match only by
# accident of ordering; they FAIL on the pre-fix script, where the trailing `$`
# could never match with `:<lineno>:` appended.
d="$(make_repo allow_self)"
add_file "$d" "scripts/check-portable-paths.sh" "# documents $WIN_PATH as an example"
run_case "the gate script may document the shapes it forbids" 0 "$d"

# `.gitignore` used to be allowlisted and had a case here. The entry exempted
# nothing in the real tree — the file matches PATTERN not at all — so it was
# pruned, and this asserts the pruning instead: an ordinary file gets no
# exemption for its name alone.
d="$(make_repo gitignore_not_exempt)"
add_file "$d" ".gitignore" "$MAC_PATH/"
run_case ".gitignore is not exempt just for being .gitignore" 1 "$d"

d="$(make_repo allow_suite)"
add_file "$d" "scripts/__tests__/check-portable-paths.test.sh" "# fixture $WIN_PATH"
run_case "this suite may carry the shapes it tests" 0 "$d"

# Unanchored entries are path SUBSTRINGS. The file is exempt; content is not.
d="$(make_repo allow_subject)"
add_file "$d" "web/src/lib/__tests__/mockOnceGuard.test.ts" "const p = '$MAC_PATH';"
run_case "a path-handling test file is exempt by its name" 0 "$d"

d="$(make_repo allow_docs)"
add_file "$d" "docs/reviews/2026-01-01-run.md" "log line: $LINUX_PATH/out"
run_case "a dated review record is exempt by its directory" 0 "$d"

# The leak the other way: an ordinary file whose CONTENT mentions an allowlist
# token must NOT be exempted. This fails on the pre-fix script.
d="$(make_repo leak_content)"
add_file "$d" "web/src/lib/config.ts" "// see mockOnceGuard for why: $MAC_PATH"
run_case "content naming an allowlist token does not exempt an ordinary file" 1 "$d"

d="$(make_repo leak_docs)"
add_file "$d" "web/src/notes.ts" "// docs/audits/ has the record: $LINUX_PATH"
run_case "content naming an allowlisted directory does not exempt a file" 1 "$d"

# --- scope and fail-closed posture ---

# The gate walks `git ls-files`, so the fixture is staged FIRST and the
# offending file written afterwards — it is present on disk and in no index.
d="$(make_repo untracked)"
(cd "$d" && git add -A) >/dev/null 2>&1
add_file "$d" "scratch.txt" "$WIN_PATH"
if (cd "$d" && PORTABLE_PATHS_MIN_FILES=3 bash "$SCRIPT") >/dev/null 2>&1; then
  PASS=$((PASS + 1)); echo "  ok   an untracked file is out of scope (exit 0)"
else
  FAIL=$((FAIL + 1)); echo "  FAIL an untracked file should be out of scope"
fi

# THE SINGLE-FILE BATCH. `grep` prints `path:line:content` only when handed more
# than one file; with exactly one it prints `line:content`. `xargs` splits by
# ARG_MAX, so a batch boundary leaving a remainder of one used to strip the path
# from those hits — `${line%%:*}` then read a line NUMBER, no allowlist entry
# could match it, and an exempt file was reported red under a nonsense name.
# A one-file repo is the only way to reach that from a fixture; the other cases
# here all fit in one multi-file batch and cannot see it.
d="$(make_repo one_file 0)"
add_file "$d" ".gitkeep" "x"
rm -f "$d/.gitkeep"
add_file "$d" "docs/coverage/dashboard.md" "measured at $MAC_PATH"
run_case "an allowlisted file survives a single-file grep batch" 0 "$d" 1

# --- scope and fail-closed posture ---

# A gate that scans almost nothing passes vacuously and reads as coverage
# (lessons-learned #9). Below the floor it must fail CLOSED, not clean.
d="$(make_repo tiny 2)"
run_case "a walk that sees too few files fails closed" 2 "$d" 500

# The floor is a real default, not something only the seam supplies.
d="$(make_repo tiny_default 2)"
(cd "$d" && git add -A) >/dev/null 2>&1
(cd "$d" && bash "$SCRIPT") >/dev/null 2>&1
if [ $? -eq 2 ]; then
  PASS=$((PASS + 1)); echo "  ok   the 500-file floor applies with no seam set (exit 2)"
else
  FAIL=$((FAIL + 1)); echo "  FAIL the default floor did not fail closed"
fi

# --- the failure report has to name the file ---

d="$(make_repo names_file)"
add_file "$d" "src/config.toml" "command = \"$WIN_PATH\""
(cd "$d" && git add -A) >/dev/null 2>&1
report="$(cd "$d" && PORTABLE_PATHS_MIN_FILES=3 bash "$SCRIPT" 2>&1)"
if grep -q 'src/config.toml' <<<"$report"; then
  PASS=$((PASS + 1)); echo "  ok   the report names the offending file"
else
  FAIL=$((FAIL + 1)); echo "  FAIL the report did not name src/config.toml"
fi
if grep -q '1 machine-local absolute path' <<<"$report"; then
  PASS=$((PASS + 1)); echo "  ok   the report counts the hits"
else
  FAIL=$((FAIL + 1)); echo "  FAIL the report did not count the hits"
fi

# --- the allowlist reports its own rot ---
#
# An entry that exempts nothing is unreviewed breadth waiting for an unrelated
# file to wander into it; five had rotted that way before anything said so. The
# note is a note and not a failure on purpose (check-npm-audit.sh's precedent):
# pruning needs a human, and a gate that reddens a PR over a stale comment gets
# deleted rather than fixed. So the assertion is that it SPEAKS.
d="$(make_repo rot_note)"
add_file "$d" "docs/coverage/dashboard.md" "measured at $MAC_PATH"
(cd "$d" && git add -A) >/dev/null 2>&1
note="$(cd "$d" && PORTABLE_PATHS_MIN_FILES=3 bash "$SCRIPT" 2>&1)"
if grep -q "exempts no file" <<<"$note"; then
  PASS=$((PASS + 1)); echo "  ok   an allowlist entry that exempts nothing is reported"
else
  FAIL=$((FAIL + 1)); echo "  FAIL no anti-rot note for an unused allowlist entry"
fi
# ...and the entry that DID exempt something is not named as unused.
if grep -q "'\^docs/(reviews|coverage)/'" <<<"$note"; then
  FAIL=$((FAIL + 1)); echo "  FAIL an entry that exempted a file was reported as unused"
else
  PASS=$((PASS + 1)); echo "  ok   an entry that exempted a file is not reported as unused"
fi

# The two parallel arrays are a bash 3.2 stand-in for a map. A reason added
# without an entry (or the reverse) shifts every later reason onto the wrong
# entry, so the mismatch is a fail-closed tooling error, not a silent misreport.
# Written without a `$` inside the single quotes on purpose: shellcheck's SC2016
# is info-level, which the local default ignores and CI treats as fatal.
if grep -qE 'ALLOW_ENTRIES\[@\][^;]*-ne[^;]*ALLOW_REASONS\[@\]' "$SCRIPT"; then
  PASS=$((PASS + 1)); echo "  ok   the entry/reason arrays are length-checked"
else
  FAIL=$((FAIL + 1)); echo "  FAIL nothing checks ALLOW_ENTRIES against ALLOW_REASONS"
fi

# --- the seam must never be wired into CI ---

echo "seam hygiene"
if grep -rl 'PORTABLE_PATHS_MIN_FILES' "$ROOT/.github/workflows" 2>/dev/null | grep -q .; then
  FAIL=$((FAIL + 1)); echo "  FAIL a workflow sets the test-only floor seam"
else
  PASS=$((PASS + 1)); echo "  ok   no workflow sets the test-only floor seam"
fi

# --- the workflow must actually invoke the gate ---

if grep -q 'scripts/check-portable-paths.sh' "$ROOT/.github/workflows/ci.yml" 2>/dev/null; then
  PASS=$((PASS + 1)); echo "  ok   ci.yml invokes the gate"
else
  FAIL=$((FAIL + 1)); echo "  FAIL ci.yml does not invoke the gate"
fi

# --- the tree the gate defends must itself be clean ---
#
# The cases above run against fixtures. This one runs the real gate over the
# real repo, so a suite that is green while `main` is dirty is not possible.
if (cd "$ROOT" && bash "$SCRIPT") >/dev/null 2>&1; then
  PASS=$((PASS + 1)); echo "  ok   the repository itself has no machine-local paths"
else
  FAIL=$((FAIL + 1)); echo "  FAIL the repository has machine-local paths (run the gate for the list)"
fi

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "SUITE PASSED"
