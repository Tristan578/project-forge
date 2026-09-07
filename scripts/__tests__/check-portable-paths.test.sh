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
# The same two homes with NO trailing component — the shape that escaped the
# pattern until review found it.
MAC_HOME="/Users/somebody"
LINUX_HOME="/home/somebody"

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

# A file may hold both. Exempting the runner OCCURRENCE, rather than dropping it
# from the pattern, is what keeps the real path visible in a file that also has
# one. This case has them on separate lines; the one below has them on the same
# line, which is what the original line-level filter could not see.
d="$(make_repo mixed)"
add_file "$d" ".github/workflows/x.yml" "  cache: $RUNNER_PATH
  home: $LINUX_PATH"
run_case "a real home path in a file that also has the runner's still fails" 1 "$d"

# THE SAME LINE, which is the case the line filter could not see. The exemption
# used to be `grep -v /home/runner/`, dropping the whole line — so a copy out of
# a runner directory into a personal one hid the personal half completely. Two
# lines already passed; one line did not (found in review). Reverting to the
# line filter fails this and leaves the two-line case above green, which is why
# both are here.
d="$(make_repo same_line)"
add_file "$d" ".github/workflows/x.yml" "  run: cp $RUNNER_PATH/out $LINUX_PATH/backup"
run_case "a real home path on the SAME LINE as the runner's still fails" 1 "$d"

# And the runner path alone on a busy line is still exempt, so the fix above did
# not simply stop exempting anything.
d="$(make_repo same_line_runner_only)"
add_file "$d" ".github/workflows/x.yml" "  run: cp $RUNNER_PATH/a $RUNNER_PATH/b"
run_case "two runner paths on one line are still portable" 0 "$d"

# --- Windows checkout roots beyond Users and repos ---
#
# `Users` and `repos` were the original two, and a checkout under a `dev`
# directory below a drive letter matched neither (found in review). Each root is
# asserted on its own so removing one from PATTERN fails a named case rather
# than a single lumped one.
for root in dev src code work workspace projects git; do
  d="$(make_repo "win_$root")"
  add_file "$d" "docs/setup.md" "Clone to C:\\${root}\\project-forge and run the build."
  run_case "a Windows checkout under $root fails" 1 "$d"
done

# The other direction: a drive-letter path that is the SAME on every Windows
# machine is portable and must not fail, or the gate starts reporting standard
# build notes and gets switched off.
d="$(make_repo win_system)"
add_file "$d" "docs/setup.md" "Install to C:\\Program Files\\MSVC and add C:\\Windows\\System32 to PATH."
run_case "a standard Windows system path passes" 0 "$d"

# --- the three ways a POSIX home path hid from this gate ----------------------
#
# All three reported by review on the pushed head, all three reproduced before
# fixing.
#
# 1. A HOME DIRECTORY AS THE FINAL COMPONENT. The pattern required a slash
#    AFTER the username, so `cd /home/somebody` — the exact shape the two skills
#    that motivated this gate used — passed clean. With the trailing slash it
#    was caught. That is the canonical case, and it was the one that escaped.
# 2. `/root`, the root user's home, was not in the pattern at all.
# 3. A FILENAME BEGINNING WITH `-` reached grep as an OPTION. `git ls-files`
#    emits bare names, so `-dash.md` parsed as `-d`/`--directories`, grep exited
#    123, and `2>/dev/null || true` swallowed it — silently discarding the WHOLE
#    xargs batch, so a real hit in a normal file batched beside it went
#    unreported too. Worse than "that one file is skipped".

d="$(make_repo home_final_linux)"
add_file "$d" "docs/setup.md" "Run: cd $LINUX_HOME && npm ci"
run_case "a Linux home directory as the final path component fails" 1 "$d"

d="$(make_repo home_final_mac)"
add_file "$d" "docs/setup.md" "Run: cd $MAC_HOME && npm ci"
run_case "a macOS home directory as the final path component fails" 1 "$d"

# `/root` IS DELIBERATELY NOT MATCHED, and this case pins that decision so it
# cannot be reversed by someone reading the review thread that proposed it.
# It is the same path on every machine, so it names nobody's checkout — the
# opposite of what this gate is for. Measured before deciding: adding it
# reported seven container `HOME` settings in the Playwright skills, where the
# path is portable by construction, plus a URL whose path component spelled it.
# If a future change does want container paths gated, that is a different gate
# with a different contract, not a wider alternative in this pattern.
d="$(make_repo root_home)"
add_file "$d" ".github/workflows/x.yml" "  env:
    HOME: /root"
run_case "the root user's home is NOT machine-local (same on every machine)" 0 "$d"

# The boundary, so widening the pattern did not turn it into a substring match.
# `/homebrew/bin` and `/rootkit/scan` contain `/home` and `/root` and are not
# home directories; neither is a lone `/home`.
d="$(make_repo posix_boundary)"
add_file "$d" "docs/setup.md" "Install to /homebrew/bin, scan with /rootkit/scan, list /home and /root-backup."
run_case "paths that merely START with /home or /root are not home directories" 0 "$d"

# The runner exemption has to survive the same widening: with the trailing slash
# no longer required, a bare `/home/runner` at the end of a command would newly
# match, and it is still the Actions HOME.
d="$(make_repo runner_final)"
add_file "$d" ".github/workflows/x.yml" "  run: cd /home/runner"
run_case "the Actions HOME as the final path component is still portable" 0 "$d"

# ...but a contributor whose account merely STARTS with `runner` is not exempt.
d="$(make_repo runner_prefix)"
add_file "$d" ".github/workflows/x.yml" "  run: cd /home/runnerbee/project"
run_case "a home directory that merely starts with 'runner' is not exempt" 1 "$d"

# A FILENAME THAT IS A GREP OPTION. Two files, so the case also pins that the
# hit in the NORMAL file survives: the failure mode was the whole batch being
# discarded, not just the odd filename.
d="$(make_repo dash_filename)"
add_file "$d" "-dash.md" "Run it from $LINUX_PATH first."
add_file "$d" "normal.md" "Run it from $LINUX_PATH first."
run_case "a filename beginning with - does not void the scan" 1 "$d"
dash_report="$(cd "$d" && PORTABLE_PATHS_MIN_FILES=3 bash "$SCRIPT" 2>&1)"
if grep -q 'normal\.md' <<<"$dash_report" && grep -q -- '-dash\.md' <<<"$dash_report"; then
  PASS=$((PASS + 1)); echo "  ok   both the dash-named file and its batch-mate are reported"
else
  FAIL=$((FAIL + 1)); echo "  FAIL a dash-named file suppressed part of its batch:"
  printf '%s\n' "$dash_report" | grep '::error file=' | sed 's/^/         /' | head -3
fi

# --- the two ways a Windows path hides from a literal match --------------------
#
# ESCAPED SEPARATORS. A TOML basic string, a JSON string and a JavaScript string
# literal all escape a backslash, so a Windows path stored in one carries a
# DOUBLED backslash on disk and a separator class matching exactly one of them
# matched none of it (found in review). Not hypothetical: this repo's own
# `fmodBridge.test.ts` asserts on a Windows path in a TS literal and was
# invisible to this gate until the separators took `+`.
#
# CASE. Windows paths are case-insensitive, so a checkout under a lowercase or
# capitalised spelling of a root the list ALREADY names walked straight through.
# The match is now case-insensitive; the standard-system-path case above is what
# holds that from widening into false failures, so keep the two together.
#
# Assembled at runtime, like the paths at the top of this file, so the suite does
# not ship strings that read as real machine-local paths.
# `%c` of 92 is a backslash. Built from the character code rather than written,
# because a literal backslash here has to survive the shell's quoting and then
# whatever reads it — the class of corruption lessons-learned #5 is about — and
# because shellcheck reads a lone quoted backslash as a probable typo (SC1003).
# Same idiom as the single quote in the malformed-regex fixture below.
ESC="$(awk 'BEGIN { printf "%c%c", 92, 92 }')"

d="$(make_repo esc_toml)"
add_file "$d" ".codex/config.toml" "cwd = \"C:${ESC}Users${ESC}someone${ESC}project-forge\""
run_case "an escaped Windows path in a TOML string fails" 1 "$d"

d="$(make_repo esc_json)"
add_file "$d" ".vscode/settings.json" "{\"cwd\": \"D:${ESC}repos${ESC}project-forge\"}"
run_case "an escaped Windows path in a JSON string fails" 1 "$d"

d="$(make_repo lower_root)"
add_file "$d" "docs/setup.md" "Clone to c:${SLASH:-/}users${SLASH:-/}someone${SLASH:-/}project-forge first."
run_case "a lowercase Windows checkout root fails" 1 "$d"

d="$(make_repo mixed_root)"
add_file "$d" "docs/setup.md" "Clone to D:${SLASH:-/}Repos${SLASH:-/}project-forge first."
run_case "a mixed-case Windows checkout root fails" 1 "$d"

# The other half of the case rule, and the reason it is two passes instead of
# one blob under `grep -i`: on a POSIX filesystem `/users/` is NOT `/Users/`.
# A blanket -i reported two Playwright docs for a lowercase URL ROUTE. The real
# tree happens to contain such a route today, so this would fail either way for
# now — but that is coverage by coincidence, and it evaporates the moment those
# two files change. This pins the rule directly.
d="$(make_repo url_route)"
add_file "$d" "docs/e2e.md" "await page.goto(\"/users/test-user/settings\");"
run_case "a lowercase /users/ URL route is not a home directory" 0 "$d"

# --- an allowlist entry exempts ONLY the files its reason names ---
#
# Entries are matched with `grep -qE` against the path, so a bare substring
# exempted every path containing it. `reaperBridge` covered production source on
# the strength of a reason describing its TEST; `generate-wasm-manifests` covered
# a shell build script, among the likeliest places for a real machine-local path
# to land (found in review). Both were invisible to the anti-rot note, because
# the entry was still "used" by its test file.
#
# One case per formerly-unanchored entry, so un-anchoring any of them again fails
# a case that names the file it would wrongly exempt.
for pair in \
  "web/src/lib/bridges/reaperBridge.ts:the allowlisted reaperBridge TEST" \
  "scripts/generate-wasm-manifests.sh:the allowlisted generate-wasm-manifests TEST" \
  "web/vitest.mockOnceGuard.fixtures.config.ts:the allowlisted mockOnceGuard files"
do
  sibling="${pair%%:*}"
  d="$(make_repo "sibling_$(basename "$sibling" | tr '.' '_')")"
  add_file "$d" "$sibling" "Run it from $MAC_PATH first."
  run_case "a machine-local path in $sibling is NOT exempted by ${pair#*:}" 1 "$d"
done

# And the anchored entries still exempt the files they name, so the fix did not
# simply delete the allowlist.
d="$(make_repo anchored_still_exempt)"
add_file "$d" "web/src/lib/bridges/__tests__/reaperBridge.test.ts" "expects('$MAC_PATH/track.wav')"
add_file "$d" "scripts/__tests__/generate-wasm-manifests.test.sh" "fixture=\"$MAC_PATH/out\""
run_case "the anchored entries still exempt the files their reasons name" 0 "$d"

# --- a malformed allowlist regex is a hard error, not a silent non-match ---
#
# The per-hit match is `grep -qE "$entry"`, and grep exits 2 on a bad pattern —
# which an `if` reads as "no match". The entry then silently stops exempting
# anything and its files are reported instead, blaming a file whose only fault
# is being covered by a typo (found in review). The compile pass names the
# entry.
# No production seam is added for this: a COPY of the real script with a broken
# entry spliced into ALLOW_ENTRIES exercises the real compile pass, and an env
# var that injected allowlist entries would be a way to widen the allowlist at
# runtime, which is the opposite of what this gate is for.
d="$(make_repo bad_allow)"
add_file "$d" "docs/setup.md" "nothing to see"
broken="$TMP/broken-allow.sh"
# `sprintf("%c", 39)` is a single quote. Writing one literally here would need
# to survive awk's quoting and the shell's at once, which is its own trap.
# Both arrays, because the length check runs first and would otherwise be what
# fails — a fixture that trips a different guard proves nothing about this one.
awk 'BEGIN { q = sprintf("%c", 39) }
     /^ALLOW_ENTRIES=\(/ { print; print "  " q "a[" q; next }
     /^ALLOW_REASONS=\(/ { print; print "  " q "a deliberately malformed fixture entry" q; next }
     { print }' "$SCRIPT" > "$broken"
# Staged, so `git ls-files` is non-empty. Without this the vacuity floor
# fires first and supplies the exit 2 this case asserts, which would make
# the case pass even if the guard under test were deleted.
(cd "$d" && git add -A) >/dev/null 2>&1
out="$(cd "$d" && PORTABLE_PATHS_MIN_FILES=1 bash "$broken" 2>&1)"; status=$?
if [ "$status" -eq 2 ] && grep -q "malformed regex" <<<"$out"; then
  PASS=$((PASS + 1)); echo "  ok   a malformed allowlist regex is a hard error, named"
else
  FAIL=$((FAIL + 1)); echo "  FAIL malformed allowlist regex: expected exit 2 with a name, got $status: $out"
fi

# --- the allowlist: matched against the path, not the whole grep line ---

# Anchored entries. Both of these pass on a `path:line:content` match only by
# accident of ordering; they FAIL on the pre-fix script, where the trailing `$`
# could never match with `:<lineno>:` appended.
# The gate script used to be allowlisted "so it can document the shapes it
# forbids". It never exempted anything — PATTERN does not match its own text —
# so the entry was pruned, and this asserts the pruning: if someone writes a
# literal example into the gate, the gate fails on itself, immediately and
# obviously, rather than carrying a standing exemption nobody re-reads.
d="$(make_repo gate_not_exempt)"
add_file "$d" "scripts/check-portable-paths.sh" "# documents $WIN_PATH as an example"
run_case "the gate script gets no exemption for being the gate" 1 "$d"

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

# Entries match the PATH, and the whole path: the exempt file is exempt, its
# content is not consulted. This case used an invented path
# (`web/src/lib/__tests__/…`) back when entries were bare substrings and any
# path containing the name matched. That substring behaviour is exactly what the
# anchoring removed, so the case now names the file the entry actually covers —
# a fixture path that no longer exists would assert the old, wrong rule.
d="$(make_repo allow_subject)"
add_file "$d" "web/src/lib/testing/__tests__/mockOnceGuard.test.ts" "const p = '$MAC_PATH';"
run_case "an allowlisted path-handling test is exempt" 0 "$d"

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

# --- the annotation has to point at the offending LINE, and the summary has to
# --- survive GitHub's per-step annotation cap ---
#
# `::error file=X::` with no `line=` defaults to line 1, and GitHub renders
# inline annotations only on lines present in the diff — so a path added deep in
# an otherwise-untouched file got a marker nowhere near the edit. grep -n had the
# number all along (found in review).
#
# The summary is emitted BEFORE the per-file loop because GitHub keeps only the
# first 10 error annotations per step, dropping the rest in creation order: last
# meant first-dropped, and the summary is the only line carrying the total.
d="$(make_repo annotation_shape)"
add_file "$d" "deep/nested/tool.sh" "line one
line two
line three
SYNC=\"$MAC_PATH\""
(cd "$d" && git add -A) >/dev/null 2>&1
ann="$(cd "$d" && PORTABLE_PATHS_MIN_FILES=3 bash "$SCRIPT" 2>&1)"
if grep -q '::error file=deep/nested/tool.sh,line=4::' <<<"$ann"; then
  PASS=$((PASS + 1)); echo "  ok   the annotation carries the offending line number"
else
  FAIL=$((FAIL + 1)); echo "  FAIL annotation is missing line=4 (defaults to line 1, rendering nowhere near the edit):"
  printf '%s\n' "$ann" | grep '::error file=' | sed 's/^/         /' | head -2
fi

summary_at="$(printf '%s\n' "$ann" | grep -n '::error::.*machine-local absolute path(s) in tracked files' | head -1 | cut -d: -f1)"
first_file_at="$(printf '%s\n' "$ann" | grep -n '::error file=' | head -1 | cut -d: -f1)"
if [ -n "$summary_at" ] && [ -n "$first_file_at" ] && [ "$summary_at" -lt "$first_file_at" ]; then
  PASS=$((PASS + 1)); echo "  ok   the count summary precedes the per-file annotations (survives the 10-annotation cap)"
else
  FAIL=$((FAIL + 1)); echo "  FAIL the summary is at line ${summary_at:-none} and the first per-file annotation at ${first_file_at:-none} — emitted last, it is the first thing GitHub drops past 10 findings"
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
#
# BEHAVIOURAL, not a containment grep. This used to be
# `grep -qE 'ALLOW_ENTRIES\[@\].*-ne.*ALLOW_REASONS\[@\]'`, which passed with
# the entire length check COMMENTED OUT (measured in review — lesson #16, the
# same defect as the wiring pin below). What that let through, reproduced: an
# eighth entry with no reason pairs every anti-rot notice with the WRONG reason,
# then the gate dies on `ALLOW_REASONS[$index]: unbound variable` and exits 1 on
# a CLEAN tree — a red build naming nothing.
#
# A spliced copy of the real script, like the malformed-regex case, so no
# production seam is added for a test.
d="$(make_repo len_mismatch)"
add_file "$d" "docs/setup.md" "nothing to see"
mismatch="$TMP/length-mismatch.sh"
awk 'BEGIN { q = sprintf("%c", 39) }
     /^ALLOW_ENTRIES=\(/ { print; print "  " q "an-eighth-entry-with-no-reason" q; next }
     { print }' "$SCRIPT" > "$mismatch"
# Staged, so `git ls-files` is non-empty. Without this the vacuity floor
# fires first and supplies the exit 2 this case asserts, which would make
# the case pass even if the guard under test were deleted.
(cd "$d" && git add -A) >/dev/null 2>&1
out="$(cd "$d" && PORTABLE_PATHS_MIN_FILES=1 bash "$mismatch" 2>&1)"; status=$?
if [ "$status" -eq 2 ] && grep -q "differ in length" <<<"$out"; then
  PASS=$((PASS + 1)); echo "  ok   an entry with no matching reason is a hard error, before any reason is read"
else
  FAIL=$((FAIL + 1)); echo "  FAIL entry/reason length mismatch: expected exit 2 naming the mismatch, got $status: $out"
fi

# --- a malformed SCAN pattern is a hard error, not a silent clean tree ---
#
# The allowlist compile pass was added first, and it guards the half that fails
# LOUDLY: a broken allowlist entry reports files it should have exempted. The
# scan patterns had no such pass, and they fail SILENTLY in the opposite
# direction — grep exits 2, both pipelines end in `|| true`, and the gate prints
# "no machine-local absolute paths" and exits 0 on a dirty tree. Measured in
# review with one bracket typo. Both patterns are pinned, separately, so
# dropping either compile_check call fails a named case.
#
# Each fixture carries a path ONLY THAT PATTERN can catch — a Windows one for
# WIN_PATTERN, a POSIX one for POSIX_PATTERN. With a shared fixture the other
# arm still reports the file, so the case would pass for the wrong reason and
# could not show the failure it exists for. Measured with the isolating
# fixtures: broken pattern + no compile pass -> `no machine-local absolute
# paths`, exit 0, on a tree that provably contains one.
for pat_var in WIN_PATTERN POSIX_PATTERN; do
  d="$(make_repo "bad_${pat_var}")"
  if [ "$pat_var" = "WIN_PATTERN" ]; then
    add_file "$d" "docs/setup.md" "Clone to $WIN_PATH first."
  else
    add_file "$d" "docs/setup.md" "Run it from $MAC_PATH first."
  fi
  broken_pat="$TMP/broken-${pat_var}.sh"
  awk -v v="$pat_var" 'BEGIN { q = sprintf("%c", 39) }
       $0 ~ "^" v "=" { print v "=" q "a[" q; next }
       { print }' "$SCRIPT" > "$broken_pat"
  # Staged, so `git ls-files` is non-empty. Without this the vacuity floor
  # fires first and supplies the exit 2 this case asserts, which would make
  # the case pass even if the guard under test were deleted.
  (cd "$d" && git add -A) >/dev/null 2>&1
  out="$(cd "$d" && PORTABLE_PATHS_MIN_FILES=1 bash "$broken_pat" 2>&1)"; status=$?
  if [ "$status" -eq 2 ] && grep -q "$pat_var is a malformed regex" <<<"$out"; then
    PASS=$((PASS + 1)); echo "  ok   a malformed $pat_var is a hard error, named"
  else
    FAIL=$((FAIL + 1)); echo "  FAIL malformed $pat_var: expected exit 2 naming it, got $status: $out"
  fi
done

# --- every allowlist entry is anchored ---
#
# The sibling cases above prove three specific entries stopped over-matching.
# They cannot cover an entry nobody has written yet, and one of the four the
# last round anchored — `provision-billing-meter` — had no case at all: reverting
# it to a bare substring left the suite green (found in review). This closes the
# class instead of adding a fourth case: an entry must start with `^` and end
# with `$` or `/`, so it names a file or a directory rather than a substring any
# future path can wander into.
# THE CUT ACCEPTS ANY SPELLING BASH DOES. It used to require exactly two spaces
# and single quotes, so a double-quoted entry — identical at runtime, and an
# over-matching substring — was invisible to it and the suite stayed green
# (found in review). Strip either quote style at any indent, and drop trailing
# comments.
allow_block="$(sed -n '/^ALLOW_ENTRIES=(/,/^)/p' "$SCRIPT")"
anchor_entries="$(printf '%s\n' "$allow_block" | sed -e '1d' -e '$d' \
  | sed -e 's/[[:space:]]*#.*$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
  | grep -v '^$' \
  | sed -e "s/^'\(.*\)'$/\1/" -e 's/^"\(.*\)"$/\1/')"

anchor_bad=""
while IFS= read -r entry; do
  [ -n "$entry" ] || continue
  case "$entry" in
    '^'*'$'|'^'*'/') ;;
    *) anchor_bad="$anchor_bad $entry" ;;
  esac
done <<<"$anchor_entries"
# NO ALTERNATION AND NO OPTIONAL GROUP IN AN ENTRY. The anti-rot flag is per
# ENTRY, so `^docs/(reviews|coverage|audits)/` stays "used" while one of its
# three branches goes dead — the dead branch is then unreviewed breadth that
# nothing can report, which is the exact argument the gate makes about whole
# entries (found in review; latent rather than live, all branches matched at the
# time). Splitting entries makes the note exact by construction, and this rule
# is what keeps them split, since the alternative was parsing these regexes to
# find their branches.
group_bad=""
while IFS= read -r entry; do
  [ -n "$entry" ] || continue
  case "$entry" in
    *'|'*)  group_bad="$group_bad $entry" ;;
    *')?'*) group_bad="$group_bad $entry" ;;
  esac
done <<<"$anchor_entries"
if [ -n "$group_bad" ]; then
  FAIL=$((FAIL + 1)); echo "  FAIL allowlist entr(ies) cover several files through one pattern —$group_bad. The anti-rot note is per entry, so such an entry stays 'used' while one of its branches goes dead and that branch becomes breadth nothing can report. Split it into one entry per file or directory, each with its own reason."
else
  PASS=$((PASS + 1)); echo "  ok   no allowlist entry hides several files behind an alternation or optional group"
fi

if [ -n "$anchor_bad" ]; then
  FAIL=$((FAIL + 1)); echo "  FAIL unanchored allowlist entr(ies) —$anchor_bad. Entries are matched with grep -qE against the path, so a bare substring exempts every path containing it: an entry named for a test exempts its production sibling too. Anchor to a file or a directory."
else
  PASS=$((PASS + 1)); echo "  ok   every allowlist entry is anchored to a file or a directory"
fi

# VACUITY, BY A DERIVED CROSS-CHECK RATHER THAN A CONSTANT FLOOR. This was
# `-ge 5` against a real count of 7, so a cut that lost two entries still
# passed — a guard set below the truth tolerates the bug it is written to
# catch, which is the sentence this same PR wrote about the needs:-list floor
# and then did not apply here (found in review). Count the quoted lines in the
# array a second way and require EQUALITY with what the cut produced.
anchor_seen="$(printf '%s\n' "$anchor_entries" | grep -c . || true)"
anchor_declared="$(printf '%s\n' "$allow_block" | sed -e '1d' -e '$d' | grep -cE "^[[:space:]]*['\"]" || true)"
if [ "$anchor_seen" -eq "$anchor_declared" ] && [ "$anchor_seen" -gt 0 ]; then
  PASS=$((PASS + 1)); echo "  ok   inspected all $anchor_seen allowlist entries for anchoring"
else
  FAIL=$((FAIL + 1)); echo "  FAIL inspected $anchor_seen of $anchor_declared allowlist entr(ies) — the cut is dropping entries, and every entry it drops is one the anchoring check above never looked at"
fi

# --- the seam must never be wired into CI ---

echo "seam hygiene"
if grep -rl 'PORTABLE_PATHS_MIN_FILES' "$ROOT/.github/workflows" 2>/dev/null | grep -q .; then
  FAIL=$((FAIL + 1)); echo "  FAIL a workflow sets the test-only floor seam"
else
  PASS=$((PASS + 1)); echo "  ok   no workflow sets the test-only floor seam"
fi

# --- the workflow must actually invoke the gate ---
#
# THIS WAS A CONTAINMENT GREP AND IT COULD NOT FAIL. `grep -q
# 'scripts/check-portable-paths.sh' ci.yml` also matches the job's own doc
# comment and the shellcheck step's ARGUMENT, so it passed with every `run:`
# line in the job commented out — measured that way by four reviewers
# independently, on a working tree where the gate was in fact disarmed. The job
# then has no executable step, so it still concludes `success`,
# `check_unconditional` reads success, and CI Success certifies green while the
# required gate does not run at all. Lessons #15 and #16.
#
# So: cut the JOB BLOCK, strip comments, and COUNT executable invocations.
# Counting rather than containing also closes YAML's last-key-wins vector — an
# appended `run: true` replaces the effective command while the original `run:`
# line stays byte-present — which is the same reason board-verdict.test.sh
# counts `run:` keys and check-ci-success.test.sh counts them per step.
CI_YML="$ROOT/.github/workflows/ci.yml"
pp_block="$(awk '
  /^  portable-paths:/ {f=1}
  f && /^  [A-Za-z_"'"'"']/ && !/^  portable-paths:/ {exit}
  f {print}
' "$CI_YML" 2>/dev/null | grep -v '^[[:space:]]*#')"

# Vacuity guard FIRST: an awk cut that reads nothing makes every count below
# zero, and "expected exactly 1, got 0" would then be reported as a wiring
# defect when the truth is that this assertion stopped being able to see the
# job at all. A renamed job must say so in its own words.
if [ -z "$pp_block" ]; then
  FAIL=$((FAIL + 1)); echo "  FAIL could not find the portable-paths job in ci.yml — renamed? the wiring pins below cannot run"
else
  PASS=$((PASS + 1)); echo "  ok   found the portable-paths job block in ci.yml"

  gate_runs="$(grep -cE '^[[:space:]]*run:[[:space:]]*bash[[:space:]]+scripts/check-portable-paths\.sh[[:space:]]*$' <<<"$pp_block" || true)"
  if [ "$gate_runs" -eq 1 ]; then
    PASS=$((PASS + 1)); echo "  ok   the job runs the gate exactly once (executable run:, not a comment)"
  else
    FAIL=$((FAIL + 1)); echo "  FAIL the portable-paths job has $gate_runs executable 'run: bash scripts/check-portable-paths.sh' line(s), expected exactly 1 — the gate is not wired to run"
  fi

  suite_runs="$(grep -cE '^[[:space:]]*run:[[:space:]]*bash[[:space:]]+scripts/__tests__/check-portable-paths\.test\.sh[[:space:]]*$' <<<"$pp_block" || true)"
  if [ "$suite_runs" -eq 1 ]; then
    PASS=$((PASS + 1)); echo "  ok   the job runs this suite exactly once"
  else
    FAIL=$((FAIL + 1)); echo "  FAIL the portable-paths job has $suite_runs executable run: line(s) for this suite, expected exactly 1 — a gate whose allowlist silently stops matching reports a clean tree either way, so the suite is the only thing that tells a passing gate from a dead one"
  fi

  # PER STEP, NOT PER JOB, and counting `run:` KEYS rather than one command.
  # The counts above match a SPECIFIC command line, which an appended second
  # `run:` does not disturb — YAML keeps the last duplicate key, so
  #     run: bash scripts/check-portable-paths.sh
  #     run: "true"
  # replaces the effective command while the pinned line stays byte-present and
  # counted. Measured: the suite stayed at PASS=53 FAIL=0 with that appended.
  # The comment here previously claimed counting closed this vector; it did not,
  # and the precedents it cited (check-ci-success.test.sh's dig_run_count,
  # board-verdict.test.sh:227) both count KEYS, which is the difference.
  #
  # A STEP-LEVEL `if:` is the other one-line disarm, and it is worse because it
  # needs no duplicate: `if: false` on the gate step skips it, a skipped step
  # does not fail its job, the job concludes `success`, and check_unconditional
  # reads success. Both reviewers on the re-run found this independently, after
  # the job-level `if:` pin was added — four spaces was half the fix.
  for step_name in "Check for machine-local absolute paths in tracked files" "Test the portable-paths gate's decision logic"; do
    step_blk="$(awk -v n="$step_name" '
      index($0, "- name: " n) { f = 1; print; next }
      f && /^      - / { exit }
      f { print }
    ' <<<"$pp_block")"
    if [ -z "$step_blk" ]; then
      FAIL=$((FAIL + 1)); echo "  FAIL could not find the '$step_name' step in the portable-paths job — renamed? its run:/if: pins cannot run"
      continue
    fi
    # `["'"]?run["'"]?` because a quoted key is the SAME key to YAML and was
    # invisible to an unquoted-only grep (found in review); check-npm-audit.test.sh
    # documents this convention and the sibling pin in check-ci-success.test.sh
    # already followed it.
    step_run_keys="$(grep -cE '^[[:space:]]*["'"'"']?run["'"'"']?[[:space:]]*:' <<<"$step_blk" || true)"
    if [ "$step_run_keys" -eq 1 ]; then
      PASS=$((PASS + 1)); echo "  ok   '$step_name' has exactly one run: key"
    else
      FAIL=$((FAIL + 1)); echo "  FAIL '$step_name' has $step_run_keys run: keys, expected exactly 1 — YAML keeps the LAST duplicate, so a second run: silently replaces the command while the original line stays present"
    fi
    if grep -qE '^[[:space:]]*["'"'"']?if["'"'"']?[[:space:]]*:' <<<"$step_blk"; then
      FAIL=$((FAIL + 1)); echo "  FAIL '$step_name' carries a step-level if: — a skipped step does not fail its job, so the job still concludes success and check_unconditional certifies the gate green while it never ran"
    else
      PASS=$((PASS + 1)); echo "  ok   '$step_name' has no step-level if:"
    fi
  done

  # `continue-on-error` makes a failing step conclude `success`, so the job
  # reports success, `check_unconditional` is satisfied, and the gate becomes
  # report-only — the exact "reports rather than gates" state this job was moved
  # into the required aggregate to leave. check-ci-success.test.sh already pins
  # this for design-internal-gate; it was not carried across when these two jobs
  # were promoted.
  if grep -q 'continue-on-error' <<<"$pp_block"; then
    FAIL=$((FAIL + 1)); echo "  FAIL the portable-paths job carries continue-on-error — a failing gate would still conclude success"
  else
    PASS=$((PASS + 1)); echo "  ok   the portable-paths job has no continue-on-error"
  fi
fi

# --- the tree the gate defends must itself be clean ---
#
# The cases above run against fixtures. This one runs the real gate over the
# real repo, so a suite that is green while `main` is dirty is not possible.
real_out="$(cd "$ROOT" && bash "$SCRIPT" 2>&1)"
real_status=$?
if [ "$real_status" -eq 0 ]; then
  PASS=$((PASS + 1)); echo "  ok   the repository itself has no machine-local paths"
else
  FAIL=$((FAIL + 1)); echo "  FAIL the repository has machine-local paths (run the gate for the list)"
  printf '%s\n' "$real_out" | sed 's/^/         /' | head -6
fi

# THE ANTI-ROT NOTE NEEDS A CONSUMER, or it is a message into the void. It is a
# `::notice::`, which never fails a job, and this case used to discard stdout —
# so a rotted entry could be reported on every run, for months, with the suite
# green and CI green. That is the same shape as a report nobody reads: lessons
# #1 and #13 together. Asserting the REAL tree emits no such notice is what
# makes the note mean something, and it is why the dead entry was pruned rather
# than left with a warning attached.
if grep -q 'exempts no file' <<<"$real_out"; then
  FAIL=$((FAIL + 1)); echo "  FAIL an allowlist entry exempts nothing in the real tree — prune it:"
  grep 'exempts no file' <<<"$real_out" | sed 's/^/         /'
else
  PASS=$((PASS + 1)); echo "  ok   every allowlist entry exempts something in the real tree"
fi

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "SUITE PASSED"
