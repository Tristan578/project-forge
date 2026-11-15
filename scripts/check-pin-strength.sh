#!/usr/bin/env bash
# check-pin-strength.sh — catch a structural pin that can be satisfied by a COMMENT.
#
# THE BUG THIS EXISTS FOR
# -----------------------
# `scripts/__tests__/db-migration-guard.test.sh` pinned the ORDER of steps in
# `cd.yml`. It carefully built a comment-stripped copy of the workflow:
#
#     cd_yml="$(cat "$CD_YML")"
#     cd_exec="$(grep -v '^[[:space:]]*#' <<<"$cd_yml" || true)"
#
# ...and then ran the ordering greps against the RAW file:
#
#     pgvector_line="$(grep -nF 'Enable pgvector extension' "$CD_YML" | ...)"
#
# When that step was deleted and a comment left explaining why, the grep matched
# THE COMMENT. The assertion compared a snapshot line number against a sentence
# and passed. It would have kept passing forever, reporting coverage of a step
# that no longer existed (#9979).
#
# That is lesson 16's family — a source pin satisfied by non-executable text —
# and lesson 11's — an assertion that cannot fail. Both lessons existed. Neither
# fired, because `.claude/hooks/inject-lessons-learned.sh` matches a lesson's
# `**Applies:**` substrings against the edited FILE PATH, and neither lesson
# listed anything matching `scripts/__tests__/*.test.sh`. The prose was right and
# unreachable. This gate is the mechanical half.
#
# THE RULE
# --------
# If a suite builds a comment-stripped copy of a file, it has declared that
# comments are not evidence. Every assertion in that suite must then read the
# stripped copy, not the raw file. Grepping an ALL-CAPS file-path variable
# directly is the tell.
#
# Deliberate exceptions are legitimate — asserting that a comment EXISTS (a
# required rationale, a documented pin) genuinely needs the raw text. Mark those
# with `# raw-grep-ok: <reason>` on the line or the line above.
#
# Exit codes: 0 clean, 1 a weak pin found, 2 tooling/vacuity error.

set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || ROOT="$(pwd)"
SUITE_DIR="${1:-${ROOT}/scripts/__tests__}"

if [ ! -d "${SUITE_DIR}" ]; then
  echo "::error::check-pin-strength: ${SUITE_DIR} does not exist." >&2
  exit 2
fi

shopt -s nullglob
suites=("${SUITE_DIR}"/*.test.sh)
shopt -u nullglob

# A gate that scans nothing is not a passing gate (lesson 9).
if [ "${#suites[@]}" -eq 0 ]; then
  echo "::error::check-pin-strength: no *.test.sh under ${SUITE_DIR} — refusing to report success having checked nothing." >&2
  exit 2
fi

scanned=0
declared=0
findings=0

for suite in "${suites[@]}"; do
  scanned=$((scanned + 1))

  # Does this suite strip comments anywhere?
  if ! grep -qF "grep -v '^[[:space:]]*#'" "${suite}"; then
    continue
  fi
  declared=$((declared + 1))

  # Find assertions that grep an ALL-CAPS variable as a FILE operand. `<<<` is a
  # here-string (a variable's contents, already stripped upstream) and is fine;
  # a bare "$VAR" at the end of a grep is a path.
  while IFS=: read -r lineno line; do
    [ -n "${lineno}" ] || continue

    # Opt-out on the line itself or the line immediately above.
    prev_lineno=$((lineno - 1))
    prev="$(sed -n "${prev_lineno}p" "${suite}")"
    if grep -qF 'raw-grep-ok' <<< "${line}" || grep -qF 'raw-grep-ok' <<< "${prev}"; then
      continue
    fi

    # A comment line is documentation, not an assertion.
    case "$(printf '%s' "${line}" | sed 's/^[[:space:]]*//')" in
      '#'*) continue ;;
    esac

    # NARROWING, so this gate stays worth reading. A noisy gate is worse than no
    # gate -- it trains everyone to skip past it, which is how the checks in
    # lessons 13 and 15 became background noise. Only ONE shape is actually
    # unsafe: an UNANCHORED search for literal prose against a raw file.
    #
    # Not flagged:
    #   1. The stripping line itself, and any grep that strips inline. Reading
    #      the raw file in order to remove its comments is the fix, not the bug.
    #   2. A pattern anchored to line start. `^[[:space:]]*"GHSA-` cannot be
    #      satisfied by `# "GHSA-...`, because the comment marker is in the way.
    #      Anchoring to structure is exactly what the fix looks like.
    if grep -qF "grep -v '^[[:space:]]*#'" <<< "${line}"; then
      continue
    fi
    # Extract the grep pattern (first single- or double-quoted argument after
    # `grep`) and skip it when it starts with `^`.
    pattern="$(printf '%s' "${line}" | sed -nE "s/.*grep[[:space:]]+(-[a-zA-Z]+[[:space:]]+)*'([^']*)'.*/\2/p")"
    if [ -z "${pattern}" ]; then
      pattern="$(printf '%s' "${line}" | sed -nE 's/.*grep[[:space:]]+(-[a-zA-Z]+[[:space:]]+)*"([^"]*)".*/\2/p')"
    fi
    case "${pattern}" in
      '^'*) continue ;;
    esac

    findings=$((findings + 1))
    echo "::error file=${suite#"${ROOT}/"},line=${lineno}::check-pin-strength: this suite builds a comment-stripped copy, then greps the raw file — the assertion can be satisfied by a COMMENT. Read the stripped copy, or mark it '# raw-grep-ok: <reason>' if asserting on comment text is the point. Offending line: ${line#"${line%%[![:space:]]*}"}" >&2
  done < <(awk '
    # Skip HEREDOC BODIES. A test suite legitimately embeds fixture source that
    # contains the very shape this gate flags -- check-pin-strength.test.sh is
    # itself full of it -- and fixture text is data, not an assertion. Without
    # this the gate flags its own tests, which is the fastest way to teach
    # everyone to ignore it.
    {
      if (in_heredoc) {
        line = $0
        sub(/^[ 	]+/, "", line)
        sub(/[ 	]+$/, "", line)
        if (line == delim) in_heredoc = 0
        next
      }
      if (match($0, /<<-?[ 	]*'"'"'?[A-Za-z_][A-Za-z0-9_]*'"'"'?/)) {
        d = substr($0, RSTART, RLENGTH)
        gsub(/^<<-?[ 	]*|'"'"'/, "", d)
        delim = d
        in_heredoc = 1
        next
      }
      if ($0 ~ /grep[ 	][^|<]*"\$[A-Z][A-Z0-9_]*"[ 	]*(\||$|\))/) {
        print NR ":" $0
      }
    }
  ' "${suite}" || true)
done

echo "check-pin-strength: scanned ${scanned} suite(s); ${declared} strip comments; ${findings} weak pin(s)."

if [ "${findings}" -gt 0 ]; then
  exit 1
fi

exit 0
