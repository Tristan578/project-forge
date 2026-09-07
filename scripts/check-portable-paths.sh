#!/usr/bin/env bash
# Fail when a tracked file hardcodes a machine-local absolute path.
#
# WHY. An absolute path in a version-controlled file resolves to nothing on
# every other machine, and it fails SILENTLY. lessons-learned #9605 is exactly
# this: the lessons hook read a path containing one contributor's username, so
# on every other checkout it took its `exit 0` branch and enforcement was off
# for entire sessions with nothing saying so. This repo is open source; assuming
# one machine's layout is assuming one contributor.
#
# Found by review on 2026-09-06: two skills hardcoded one contributor's home
# directory. One told the reader to `cd` into it before running a sync script;
# the other passed absolute paths to `require()` and to a `grep`. Neither would
# work for anyone else, and neither announced that. An MCP server pinned to one
# contributor's Windows checkout was found the same day in a WORKING COPY of
# `.codex/config.toml` — never committed, so nothing in this repository records
# it and no CI run could have. That is exactly why a gate over TRACKED files is
# the thing worth having: it catches the moment such a path becomes everybody's
# problem instead of one machine's.
#
# The forbidden shapes are spelled out ONCE, in WIN_PATTERN and POSIX_PATTERN
# below, and nowhere else in the tree: a file that quotes an example is a file
# this gate then fails on. That is why the workflow step carries a pointer here
# rather than a copy.
#
# bash 3.2 compatible on purpose — macOS ships 3.2 as /bin/bash and the rest of
# the CI self-defense scripts hold that floor (check-skills.sh,
# check-changeset-packages.sh, .claude/rules/gotchas-build-ci.md).
#
# TWO grep passes over the whole tracked set — one per pattern, because the two
# filesystems disagree about case (see below) — and NOT a per-file loop: the
# loop form took minutes on this repo's ~3,500 files, and a gate slow enough to
# be annoying is a gate someone eventually stops running.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || { echo "::error::could not cd to repo root"; exit 1; }

# Absolute forms that name one machine: a Windows drive-letter path into a
# checkout root, or a POSIX home directory. Deliberately NOT anchored to a
# username, so a different contributor's path is caught too.
#
# THE WINDOWS ROOT LIST IS AN ENUMERATED LIST OF CHECKOUT HABITS, not of
# everything after a drive letter. (It is a denylist — these roots FAIL. The
# word "allowlist" is reserved below for ALLOW_ENTRIES, which exempts; using it
# for both is what made this block hard to read.)
#
# `C:\Program Files\...` and `C:\Windows\...` are the
# same on every Windows machine and appear legitimately in build notes, so
# matching every `C:\` would fail on paths that are perfectly portable. The
# roots here are the ones people actually clone into. `Users` and `repos` were
# the original two, and a checkout under a `dev` directory sitting directly
# below a drive letter escaped both (found in review). Described rather than
# shown, for the same reason as the runner note further down: this gate reads
# its own source, so a literal example fails it.
#
# A root nobody has thought of still escapes; that is the cost of enumerating
# roots, and it is the right cost, because the other direction produces false
# failures on standard system paths and gets the gate switched off.
#
# THE SEPARATORS TAKE `+`. A TOML basic string, a JSON string and a JavaScript
# string literal all ESCAPE a backslash, so a Windows path stored in one carries
# a DOUBLED backslash on disk, and a class matching exactly one separator
# matched none of it (found in review). The measured example is this repo's own
# `fmodBridge.test.ts`, which asserts on a Windows path in a TS literal and was
# invisible to this gate until the `+` — it is on the allowlist now, and it was
# not on it before, because nothing had ever reported it.
#
# The `.codex/config.toml` that motivated this gate spelled its paths with
# forward slashes, which the single-separator form already caught — so this is a
# hole that find would NOT have shown, rather than one it did. That file was
# never committed, so this sentence cannot be checked from the repository; it is
# recorded as the reason the hole went unnoticed, not as evidence for the fix.
# The evidence for the fix is `fmodBridge.test.ts`, which is tracked.
#
# TWO PATTERNS, BECAUSE THE TWO FILESYSTEMS DISAGREE ABOUT CASE. Windows paths
# are case-insensitive, so a lowercase or capitalised spelling of a root this
# list already names walked straight through, and the Windows pass runs under
# `grep -i`. POSIX paths are NOT, and `/users/` is a different path from
# `/Users/` — under a blanket `-i` this gate reported two Playwright docs for
# `/users/<id>/settings`, which is a URL route, not a home directory. One blob
# cannot hold both rules, so it is two passes over the same file set rather than
# one, and a false failure on a URL is how a gate gets switched off. Each pass
# is a single grep over ~3,500 files: a few seconds on a Linux runner, and
# roughly ten times that under Git Bash on Windows, where process spawning
# dominates. Both numbers are environment-specific, which is why neither is
# stated as "the" runtime.
#
# Case-insensitivity does not widen the allowlist direction: the roots are still
# an enumerated list, and the standard-system-path case in the suite pins that
# `Program Files` and `Windows` keep passing.
#
# THE POSIX SIDE DOES NOT REQUIRE A TRAILING COMPONENT. Each alternative used to
# end with a slash, so a `cd` into a home directory with nothing after it — the
# exact form the two skills that motivated this gate used — matched nothing,
# while the same path with a trailing slash matched. The canonical case was the
# one that escaped (found in review). A home directory is a home directory
# whether or not something follows it, so the trailing slash is now a BOUNDARY:
# one character that cannot continue a name, or end of line. Described rather
# than shown, like the Windows roots above: this gate reads its own source.
#
# The boundary is what keeps the widening from becoming a substring match. A
# path that merely BEGINS with the letters of a home root — a Homebrew prefix,
# say — is not a home directory, and the suite pins that direction beside this
# one.
#
# `/root` was proposed in review and is deliberately NOT here. It is the same on
# every machine, so it names nobody's checkout, and the measurement said so:
# adding it reported seven container `HOME` settings in the Playwright skills,
# where that path is portable by construction, plus a URL whose path component
# happened to spell it. This gate is for paths that name ONE machine.
WIN_PATTERN='[A-Za-z]:[\\/]+(Users|repos|dev|src|code|work|workspace|projects|git)[\\/]+'
POSIX_PATTERN='(/Users/[A-Za-z0-9._-]+|/home/[A-Za-z0-9._-]+)([^A-Za-z0-9._-]|$)'

# Files where such a string is legitimate. Each entry states why, and each entry
# EXEMPTS SOMETHING TODAY — an allowlist entry that covers no file is not
# harmless, it is unreviewed breadth waiting for a file to wander into it. Six
# entries were pruned for exempting nothing: `docs/audits/`, `.gitignore`, the
# unanchored `check-vitest-exit`, `db-migration-guard` and `sentry-to-test-stub`
# (whose only matches were `/home/runner/` lines the filter below already
# strips), and THIS SCRIPT.
#
# That last one is worth stating, because keeping it was the tempting choice.
# The patterns are written so they do not match their own text, so the entry
# had never exempted anything, and a first version of this list kept it on the
# reasoning that the gate "must be able to document the shapes it forbids". It
# does not need to: the shapes are the pattern, and prose describes them. An
# entry held for a hypothetical is the same unreviewed breadth as one held out
# of habit. If someone does write a literal example here, this gate fails on
# itself immediately and obviously, which is a better outcome than a standing
# exemption nobody re-reads.
#
# The anti-rot note at the end reports any entry that stops exempting something,
# and the suite asserts the real tree produces NO such note — so the note has a
# consumer rather than being a message into the void.
#
# Matched against the FILE PATH ALONE, never the `path:line:content` string that
# grep emits. Against the whole string every `$`-anchored entry here is
# unreachable — `...\.sh$` cannot match when `:12:# ...` follows the name — so
# this gate used to fail on its own header comment, while every UNanchored entry
# leaked the other way and exempted any line whose CONTENT merely said
# `mockOnceGuard`. Both directions are pinned by the suite.
#
# ONE ENTRY PER FILE OR DIRECTORY — NO ALTERNATION, NO OPTIONAL GROUP. The
# anti-rot flag below is per ENTRY, so an entry covering several files through
# `(a|b)` or `(...)?` stays "used" while one of its branches goes dead, and that
# branch then sits here as unreviewed breadth that nothing can report (found in
# review). Splitting them makes the anti-rot note exact by construction rather
# than by parsing these regexes, and it forces each covered file to carry its
# OWN reason — the grouped `mockOnceGuard` entry had one sentence explaining two
# different files. The suite refuses an entry containing either construct.
#
# EVERY ENTRY IS ANCHORED TO THE FILES ITS REASON NAMES. Entries are matched
# with `grep -qE` against the path, so a bare substring exempts every path
# containing it — `reaperBridge` covered `reaperBridge.ts`, production source,
# on the strength of a reason describing its TEST, and `generate-wasm-manifests`
# covered a shell build script, which is among the likeliest places for a real
# machine-local path to land. Neither had any hits, so the anti-rot note could
# not see the breadth either: the entry was still "used" by its test file
# (found in review). An anchored entry that stops matching gets reported; an
# unanchored one silently widens.
#
# bash 3.2 has no associative arrays, so the entries and their reasons are two
# parallel indexed arrays. Keep them the same length; the script checks.
ALLOW_ENTRIES=(
  '^docs/reviews/'
  '^docs/coverage/'
  '^docs/audits/'
  '^scripts/__tests__/check-portable-paths\.test\.sh$'
  '^web/scripts/provision-billing-meter\.ts$'
  '^web/scripts/__tests__/provision-billing-meter\.test\.ts$'
  '^web/vitest\.mockOnceGuard\.ts$'
  '^web/src/lib/testing/__tests__/mockOnceGuard\.test\.ts$'
  '^scripts/__tests__/generate-wasm-manifests\.test\.sh$'
  '^web/src/lib/bridges/__tests__/reaperBridge\.test\.ts$'
  '^web/src/lib/bridges/__tests__/fmodBridge\.test\.ts$'
)
ALLOW_REASONS=(
  'dated review records; rewriting them would falsify what the reviewer saw'
  'dated coverage records; the numbers are a snapshot, not instructions'
  'dated audit records; one carries the reviewers own checkout path in a quoted transcript'
  "this gate's own suite, which builds the shapes it tests"
  'code ABOUT path handling — the literal is the subject, not a path to follow'
  'that scripts test, which quotes real paths as fixtures'
  'test infrastructure ABOUT path handling — a comment on a path with a space in it'
  'its test, which asserts on the same path shapes'
  'the generator TEST, which quotes real paths as fixtures; the generator itself is not exempt'
  'a path-handling test: 8 hits, of which 2 are refused inputs (one traversal, one NUL byte)'
  'asserts isSafePath ACCEPTS a Windows absolute path; the literal is the subject'
)
if [ "${#ALLOW_ENTRIES[@]}" -ne "${#ALLOW_REASONS[@]}" ]; then
  echo "::error::check-portable-paths: ALLOW_ENTRIES and ALLOW_REASONS differ in length" >&2
  exit 2
fi

# EVERY REGEX IS COMPILED BEFORE ANY OF THEM IS TRUSTED. grep exits 2 on a bad
# pattern, with its complaint on stderr — and every use here reads that as
# "no match", because `if` cannot tell 1 from 2 and the scan pipelines end in
# `|| true`. So a typo fails SILENTLY, and which direction it fails depends on
# which regex holds it:
#
#   - an ALLOW_ENTRIES typo stops exempting anything, and its files are reported
#     as violations: a red build blaming a file whose only fault is being
#     covered by the broken entry.
#   - a SCAN PATTERN typo is far worse: the scan matches nothing, the gate
#     prints "no machine-local absolute paths" and exits 0 on a dirty tree.
#     Measured in review with a single bracket typo, on a tree that provably
#     contains matching paths. The MIN_FILES floor below cannot catch it —
#     `tracked_count` comes from `git ls-files`, a pipeline that never touches
#     grep, so it asserts the file listing and not the scan (lesson #1: assert
#     the property, not the adjacent one).
#
# The first version of this compiled the allowlist only, which is the half that
# fails LOUDLY. Both are compiled now, and the suite pins both.
compile_check() {
  local what="$1" pat="$2"
  printf '' | grep -qE "$pat" 2>/dev/null
  # grep exits 1 on "no match" (fine) and 2 on a bad pattern (the defect).
  if [ "$?" -gt 1 ]; then
    echo "::error::check-portable-paths: ${what} is a malformed regex: ${pat}" >&2
    exit 2
  fi
}

compile_check "WIN_PATTERN" "$WIN_PATTERN"
compile_check "POSIX_PATTERN" "$POSIX_PATTERN"
for entry in "${ALLOW_ENTRIES[@]}"; do
  compile_check "ALLOW_ENTRIES" "$entry"
done

tracked_count="$(git ls-files | wc -l | tr -d ' ')"

# `/home/runner/` is the GitHub Actions HOME — identical on every runner, so it
# is portable by construction. Workflows set cache dirs under it and several
# suites quote CI output containing it.
#
# THE OCCURRENCE IS EXEMPT, NOT THE LINE. This used to be
# `grep -v '/home/runner/'`, which drops the whole line — so a line carrying
# BOTH the runner path and a contributor's own home directory — a copy out of a
# runner work directory into a personal one — vanished entirely, and the
# machine-local half went unreported (found in review). Described rather than
# shown: this gate reads its own source, so a literal example fails it, which is
# how the first version of this comment was caught.
#
# Replacing the runner occurrences with a token that cannot match, then
# re-applying POSIX_PATTERN, keeps every other match on the line.
#
# The exemption carries the SAME boundary rule as the pattern, for the same
# reason: once the pattern stopped requiring a trailing component, the runner's
# HOME at the end of a command newly matched, and it is still portable.
# Exempting it WITHOUT a boundary would be worse than the bug — it would also
# exempt any contributor whose username merely begins with those six letters.
# The suite pins both directions.
#
# LINUX RUNNERS ONLY, despite "every runner" above — the exemption is the
# literal string `/home/runner/`, and the other two hosted platforms do not use
# it:
#
#   * macOS runners put HOME under the mac home root rather than the Linux one,
#     so POSIX_PATTERN matches it and this sed does not touch it.
#   * Windows runners have a drive-letter home under `Users`, which the Windows
#     pass matches, and the sed is applied to the POSIX pipeline alone.
#
# So a tracked file quoting macOS or Windows runner output is reported as
# machine-local. Nothing does today. When something does, the fix is an anchored
# allowlist entry naming that file — not widening this exemption, which would
# also exempt a contributor whose own username happens to be `runner`.
#
# `--` IS LOAD-BEARING TOO, AND SO IS `-e`. `git ls-files` emits BARE names, so
# a tracked file called `-dash.md` reaches grep as an OPTION: `-d` parses as
# `--directories`, grep exits 123 having scanned nothing, and `2>/dev/null ||
# true` swallows the complaint. That does not merely skip the odd file — xargs
# hands grep a whole BATCH, so one such name silently discards every hit in it,
# including a real one in an ordinary file beside it. Measured that way in
# review. `--` ends option parsing; `-e` does the same for the pattern.
#
# `-H` IS LOAD-BEARING. Without it grep prints `path:line:content` only when it
# is handed more than one file, and `line:content` when handed exactly one.
# `xargs` splits by ARG_MAX — seven batches on a 3,484-file checkout here — so a
# batch boundary leaving a remainder of one silently drops the path from those
# hits. `${line%%:*}` then reads a LINE NUMBER, no allowlist entry can ever
# match it, and the file is reported as `::error file=<lineno>::`. It fails in
# the closed direction, but it turns an exempt file into a red build with a
# nonsense name. The suite DOES reach it: the `one_file` case builds a one-file
# repo for exactly that purpose, which is the only way a fixture can. Removing
# `-H` fails that case and only that one. An earlier version of this sentence
# said no fixture could reach it, in the same commit that added the case.
win_hits="$(git ls-files -z \
  | xargs -0 grep -HIinE -e "$WIN_PATTERN" -- 2>/dev/null || true)"
posix_hits="$(git ls-files -z \
  | xargs -0 grep -HInE -e "$POSIX_PATTERN" -- 2>/dev/null \
  | sed -E 's#/home/runner([^A-Za-z0-9._-]|$)#{RUNNER_HOME}\1#g' \
  | grep -E "$POSIX_PATTERN" || true)"
raw="$(printf '%s\n%s\n' "$win_hits" "$posix_hits" | grep . || true)"

# The allowlist is applied per hit, to the path grep prefixed onto the line, so
# an entry can be anchored to a whole path without also having to survive the
# `:<lineno>:<content>` grep appends. Hits are few by construction, so the loop
# costs nothing next to the two grep passes above. A here-string, not a pipe:
# `grep -q` exits on first match and SIGPIPEs its writer, which under pipefail
# inverts the verdict.
hits=""
# One flag per entry, so the anti-rot note below can name an entry that stopped
# exempting anything. Parallel to ALLOW_ENTRIES by index (bash 3.2, no maps).
allow_used=""
for _ in "${ALLOW_ENTRIES[@]}"; do allow_used="${allow_used}0"; done

while IFS= read -r line; do
  [ -n "$line" ] || continue
  file="${line%%:*}"
  exempt=0
  index=0
  # NO `break`: every entry that covers this file is marked, not just the first.
  # Stopping at the first match reports a SHADOWED entry as rot even while it
  # genuinely covers files, and a notice with false positives is one people stop
  # reading — which would defeat the note more completely than deleting it.
  for entry in "${ALLOW_ENTRIES[@]}"; do
    if grep -qE "$entry" <<<"$file"; then
      exempt=1
      allow_used="${allow_used:0:index}1${allow_used:$((index + 1))}"
    fi
    index=$((index + 1))
  done
  [ "$exempt" -eq 1 ] && continue
  hits="${hits}${line}"$'\n'
done <<<"$raw"
hits="${hits%$'\n'}"

# A gate that scans nothing passes vacuously and reads as coverage
# (lessons-learned #9). This repo tracks thousands of files; if the walk ever
# sees a handful, the walk broke rather than the repo shrinking.
#
# PORTABLE_PATHS_MIN_FILES is a TEST-ONLY seam, so the suite can run the gate
# against a small throwaway repo. It is never set in CI, and the suite asserts
# no workflow sets it — wiring it would let a broken walk pass as a clean one.
MIN_FILES="${PORTABLE_PATHS_MIN_FILES:-500}"
if [ "$tracked_count" -lt "$MIN_FILES" ]; then
  echo "::error::check-portable-paths saw only ${tracked_count} tracked file(s), floor ${MIN_FILES} — the walk is broken, not the repo"
  exit 2
fi

if [ -n "$hits" ]; then
  # THE SUMMARY GOES FIRST. GitHub renders at most 10 error annotations per step
  # and drops the rest in creation order, so a summary emitted after the per-file
  # loop is the FIRST thing lost on any run with more than ten hits — and this
  # gate scans the whole tracked set, so a large first count is the ordinary
  # case, not the edge one. Someone would then see ten markers, no total, and no
  # sign that more exist: they fix ten, push, and meet a second round with
  # nothing explaining why the first looked complete (found in review).
  count="$(printf '%s\n' "$hits" | grep -c . || true)"
  echo "::error::${count} machine-local absolute path(s) in tracked files."
  echo "Use a repo-relative path, \$(git rev-parse --show-toplevel), or an environment"
  echo "variable. A tool that genuinely needs a machine-local path belongs in a personal"
  echo "config that is not checked in, not in a tracked one — see CONTRIBUTING.md"
  echo "(\"Machine-local absolute paths\"), which also gives the command to run this"
  echo "gate locally and how to request an allowlist entry."

  echo "$hits" | while IFS= read -r line; do
    [ -n "$line" ] || continue
    # `path:lineno:content`, from grep -n. The LINE NUMBER IS PASSED THROUGH:
    # without `line=`, GitHub defaults the annotation to line 1, and it renders
    # inline only on lines present in the diff — so an offending path deep in an
    # otherwise-untouched file produced a marker that appeared nowhere near the
    # edit, or at all. grep already captured the number; the first version threw
    # it away (found in review).
    file="${line%%:*}"
    rest="${line#*:}"
    lineno="${rest%%:*}"
    # Fall back to the file-level form if the number is not a number, rather
    # than emitting `line=` with junk in it: a malformed annotation is dropped
    # by GitHub silently, which would lose the finding altogether.
    case "$lineno" in
      ''|*[!0-9]*) echo "::error file=${file}::machine-local absolute path: ${line}" ;;
      *)           echo "::error file=${file},line=${lineno}::machine-local absolute path: ${line}" ;;
    esac
  done
  exit 1
fi

# ANTI-ROT. An allowlist entry that exempts nothing is unreviewed breadth: the
# file it was written for is gone, and the entry now waits for an unrelated one
# to wander into it. Five had already rotted that way before anything reported
# it.
#
# THIS GATE ONLY NOTES. It follows check-npm-audit.sh's precedent: the pruning
# decision needs a human, and a `::notice::` never fails a job.
#
# THE SUITE, HOWEVER, FAILS ON IT — `check-portable-paths.test.sh` asserts the
# REAL tree emits no such notice, and the suite runs as step 1 of a job that is
# now required. So the effective severity is "blocks the merge", and saying only
# "notes rather than fails" here described the weaker half (found in review).
# Both are deliberate and they do different jobs: the notice is for whoever is
# reading this run's log, the suite assertion is what stops a rotted entry
# living in `main` for months unread — a note nobody consumes is lesson #13.
#
# What that costs, stated plainly because it lands on someone eventually:
# deleting or renaming the last file an entry covers turns this red, and the fix
# is to prune the entry in the same change. CONTRIBUTING.md documents that under
# "Machine-local absolute paths". If that ever becomes the wrong trade — a
# contributor blocked on an allowlist they have no context for — the assertion
# is the half to soften, not the notice, because the notice is what makes the
# entry visible in the first place.
index=0
for entry in "${ALLOW_ENTRIES[@]}"; do
  if [ "${allow_used:$index:1}" = "0" ]; then
    echo "::notice::check-portable-paths: allowlist entry '${entry}' (${ALLOW_REASONS[$index]}) exempts no file — safe to prune"
  fi
  index=$((index + 1))
done

echo "check-portable-paths: ${tracked_count} tracked file(s), no machine-local absolute paths"
