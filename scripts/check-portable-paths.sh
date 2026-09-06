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
# Found by review on 2026-09-06: two skills told the reader to `cd` into one
# contributor's home directory before running a sync script. Neither would work
# for anyone else, and neither announced that. An MCP server pinned to one
# contributor's Windows checkout was found the same day in a working copy of
# `.codex/config.toml` — that one was never committed, which is exactly why a
# gate over TRACKED files is the thing worth having: it catches the moment such
# a path becomes everybody's problem instead of one machine's.
#
# The forbidden shapes are spelled out ONCE, in PATTERN below, and nowhere else
# in the tree: a file that quotes an example is a file this gate then fails on.
# That is why the workflow step carries a pointer here rather than a copy.
#
# bash 3.2 compatible on purpose — macOS ships 3.2 as /bin/bash and the rest of
# the CI self-defense scripts hold that floor (check-skills.sh,
# check-changeset-packages.sh, .claude/rules/gotchas-build-ci.md).
#
# ONE grep pass over the whole tracked set, not a per-file loop: the loop form
# took minutes on this repo's ~3,500 files, and a gate slow enough to be
# annoying is a gate someone eventually stops running.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || { echo "::error::could not cd to repo root"; exit 1; }

# Absolute forms that name one machine: a Windows drive-letter path into a user
# or repo directory, or a POSIX home directory. Deliberately NOT anchored to a
# username, so a different contributor's path is caught too.
PATTERN='([A-Za-z]:[\\/](Users|repos)[\\/]|/Users/[A-Za-z0-9._-]+/|/home/[A-Za-z0-9._-]+/)'

# Files where such a string is legitimate. Each entry states why, and each entry
# EXEMPTS SOMETHING TODAY — an allowlist entry that covers no file is not
# harmless, it is unreviewed breadth waiting for a file to wander into it. Six
# entries were pruned for exempting nothing: `docs/audits/`, `.gitignore`, the
# unanchored `check-vitest-exit`, `db-migration-guard` and `sentry-to-test-stub`
# (whose only matches were `/home/runner/` lines the filter below already
# strips), and THIS SCRIPT.
#
# That last one is worth stating, because keeping it was the tempting choice.
# PATTERN is written so it does not match its own text, so the entry had never
# exempted anything, and a first version of this list kept it anyway on the
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
# bash 3.2 has no associative arrays, so the entries and their reasons are two
# parallel indexed arrays. Keep them the same length; the script checks.
ALLOW_ENTRIES=(
  '^docs/(reviews|coverage)/'
  '^scripts/__tests__/check-portable-paths\.test\.sh$'
  'provision-billing-meter'
  'mockOnceGuard'
  'generate-wasm-manifests'
  'reaperBridge'
)
ALLOW_REASONS=(
  'dated records of what a tool printed; rewriting them would falsify the record'
  "this gate's own suite, which builds the shapes it tests"
  'code ABOUT path handling — the literal is the subject, not a path to follow'
  'test infrastructure ABOUT path handling'
  'a generator whose test quotes real paths as fixtures'
  'asserts a traversal attempt is REFUSED; the literal is the attack'
)
if [ "${#ALLOW_ENTRIES[@]}" -ne "${#ALLOW_REASONS[@]}" ]; then
  echo "::error::check-portable-paths: ALLOW_ENTRIES and ALLOW_REASONS differ in length" >&2
  exit 2
fi

ALLOW_RE=""
for entry in "${ALLOW_ENTRIES[@]}"; do
  if [ -z "$ALLOW_RE" ]; then ALLOW_RE="$entry"; else ALLOW_RE="${ALLOW_RE}|${entry}"; fi
done

tracked_count="$(git ls-files | wc -l | tr -d ' ')"

# `/home/runner/` is the GitHub Actions HOME — identical on every runner, so it
# is portable by construction. Workflows set cache dirs under it and several
# suites quote CI output containing it. Filtered by LINE rather than removed
# from PATTERN, so a genuine `/home/<someone>/` in the same file still fails.
#
# `-H` IS LOAD-BEARING. Without it grep prints `path:line:content` only when it
# is handed more than one file, and `line:content` when handed exactly one.
# `xargs` splits by ARG_MAX — seven batches on a 3,484-file checkout here — so a
# batch boundary leaving a remainder of one silently drops the path from those
# hits. `${line%%:*}` then reads a LINE NUMBER, no allowlist entry can ever
# match it, and the file is reported as `::error file=<lineno>::`. It fails in
# the closed direction, but it turns an exempt file into a red build with a
# nonsense name, and no fixture can reach it: the suite's repos are small enough
# to be one batch.
raw="$(git ls-files -z \
  | xargs -0 grep -HInE "$PATTERN" 2>/dev/null \
  | grep -v '/home/runner/' || true)"

# The allowlist is applied per hit, to the path grep prefixed onto the line, so
# an entry can be anchored to a whole path without also having to survive the
# `:<lineno>:<content>` grep appends. Hits are few by construction, so the loop
# costs nothing next to the single grep pass above. A here-string, not a pipe:
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
  echo "$hits" | while IFS= read -r line; do
    [ -n "$line" ] || continue
    file="${line%%:*}"
    echo "::error file=${file}::machine-local absolute path: ${line}"
  done
  count="$(printf '%s\n' "$hits" | grep -c . || true)"
  echo "::error::${count} machine-local absolute path(s) in tracked files."
  echo "Use a repo-relative path, \$(git rev-parse --show-toplevel), or an environment"
  echo "variable. A tool that genuinely needs a machine-local path belongs in a personal"
  echo "config that is not checked in, not in a tracked one — see CONTRIBUTING.md."
  exit 1
fi

# ANTI-ROT. An allowlist entry that exempts nothing is unreviewed breadth: the
# file it was written for is gone, and the entry now waits for an unrelated one
# to wander into it. Five had already rotted that way before anything reported
# it. This follows check-npm-audit.sh's precedent and NOTES rather than fails —
# the pruning decision needs a human, and a gate that reddens a PR for a stale
# comment gets deleted rather than fixed.
index=0
for entry in "${ALLOW_ENTRIES[@]}"; do
  if [ "${allow_used:$index:1}" = "0" ]; then
    echo "::notice::check-portable-paths: allowlist entry '${entry}' (${ALLOW_REASONS[$index]}) exempts no file — safe to prune"
  fi
  index=$((index + 1))
done

echo "check-portable-paths: ${tracked_count} tracked file(s), no machine-local absolute paths"
