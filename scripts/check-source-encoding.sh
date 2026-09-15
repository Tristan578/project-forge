#!/usr/bin/env bash
# Reject invisible control bytes in tracked source files.
#
# WHY THIS EXISTS
#
# Nothing else in the pipeline rejects a control byte in a source file. They are
# invisible in ordinary output, survive lint, typecheck and tests, and change
# behaviour silently. Observed three times in one session, each producing an
# artifact that passed every check:
#
#   * `\b` written through a shell heredoc became a literal BACKSPACE (0x08)
#     inside a regex. `/^application\/wasm\x08/` matches nothing, so a MIME gate
#     silently passed every value it was meant to reject. Only `cat -A` showed it.
#   * Backslash line continuations were stripped, collapsing a multi-line
#     `aws s3 cp` onto one line. Valid bash, nothing failed, and a later edit
#     could drop a flag into the run of spaces without anyone seeing it.
#   * `\\` + newline collapsed to a bare newline, so a byte-exact anti-tamper
#     pin quietly stopped matching the thing it pinned.
#
# The class is "the artifact is wrong while the tests are green", which is the
# same shape as the CDN outages this milestone has been chasing. A raw NUL is
# worse than untidy: git and many tools classify a file containing one as
# BINARY, so it can vanish from `git grep -I`, be skipped by linters, and fail
# to render in code review.
#
# TAB and LF are legitimate. Nothing else in the C0 range is typed on purpose,
# and anything genuinely needed is written as an escape (`\0`, `\t`) -- which is
# what makes it reviewable. Hence no allowlist.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

# TEST SEAM: a newline-separated list of paths to scan instead of the tracked
# tree, so the suite can drive fixtures without committing corrupt files.
FILE_LIST="${SOURCE_ENCODING_FILE_LIST:-}"

# Extensions treated as source text. Deliberately explicit: see the warning
# about `git grep -I` below.
EXT_RE='\.(ts|tsx|js|jsx|mjs|cjs|json|md|sh|bash|yml|yaml|toml|rs|css|scss|html|txt|wgsl|snap)$'

if [ -n "$FILE_LIST" ]; then
  if [ ! -f "$FILE_LIST" ]; then
    echo "::error::check-source-encoding: SOURCE_ENCODING_FILE_LIST points at '${FILE_LIST}', which does not exist" >&2
    exit 64
  fi
  files="$(cat "$FILE_LIST")"
else
  cd "$ROOT" || exit 64
  # NOT `git grep -I`. That is the exact trap this gate exists to catch: `-I`
  # skips files git believes are binary, and a NUL byte is what makes git
  # believe it. The worst case -- a NUL early in a file -- is precisely the one
  # that would be silently skipped. Enumerate by name and read each explicitly.
  files="$(git ls-files | grep -E "$EXT_RE" || true)"
fi

if [ -z "$files" ]; then
  echo "::error::check-source-encoding: no files to scan. A gate that matches nothing passes vacuously and reads as coverage; refusing to report success." >&2
  exit 1
fi

scanned=0
bad=0
bad_run=0

# A second, narrower corruption: a shell line continuation (' \' + newline)
# collapsed into the two ASCII characters '\' and 'n' (0x5C 0x6E), joining two
# command lines into one run-on line inside a workflow `run:` block. This is not
# a control byte, so the scan above cannot see it, and YAML parses the result
# perfectly because the corruption lives inside the shell body where YAML has no
# opinion (issue #9987; a real instance in ci.yml was caught only by an
# unrelated byte-exact pin).
#
# WHY THIS SIGNATURE, and why not the others considered:
#
# The tell is WHITESPACE immediately before the backslash-n. A line continuation
# is written ' \' -- a space (or tab) then a backslash at end of line -- so the
# collapse always yields ' \n'. Every LEGITIMATE '\n' in a workflow is an escape
# glued to a non-space: printf '%s\n', curl -w '\n%{http_code}', a JSON "...\n".
# Across all workflows in this repo the sequence <whitespace>\n appears zero
# times, so this signature catches the corruption with no false positive -- which
# the acceptance criteria require, or the gate lands red and gets routed around.
# Matching EVERY '\n' in a run: block was rejected for exactly that reason (it
# flags printf/curl format strings, which are everywhere). Quote-stripping to
# find "unquoted" '\n' was rejected too: it misfires on the generated *.lock.yml
# files whose run: blocks embed multi-line escaped-JSON with nested \" quoting.
#
# Two options from #9987 are deliberately NOT taken here; the reasoning is
# recorded so the next person does not re-derive it:
#   * A general `verify-*` shell helper library (assert_no_literal_backslash_n,
#     assert_yaml_step_command, ...) is the broad win, but it has no forcing
#     function: nothing makes a given session adopt it, so it does not prevent
#     the mistake, it only offers a correct implementation to whoever remembers
#     to call it. A CI gate runs unconditionally; a helper does not.
#   * A lessons-learned entry with a Bash-command trigger (matching an ad-hoc
#     `yaml.safe_load`/`grep -n` in a command line) only WARNS before a mistake;
#     it cannot FAIL a corruption that already landed. This gate does, on every
#     push, which is the property that makes it worth committing.
# Both remain worth doing; this PR ships the narrow, mechanically-enforceable
# win that #9987 says should land regardless.

while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ -f "$f" ] || continue
  scanned=$((scanned + 1))
  # 0x0D (CR) is deliberately outside the class for most files, but a shell
  # source with CRLF dies at its shebang on every platform the suites run on
  # (#9611), so for *.sh / *.bash it is rejected like any other control byte.
  case "$f" in
    *.sh|*.bash) control_class='\x00-\x08\x0B\x0C\x0D\x0E-\x1F' ;;
    *) control_class='\x00-\x08\x0B\x0C\x0E-\x1F' ;;
  esac
  # perl reads NUL-bearing files without complaint, unlike several shell tools.
  # Report line and column so the finding is actionable without `cat -A`.
  hits="$(SRC_ENC_CLASS="$control_class" perl -ne '
    my $re = qr/[$ENV{SRC_ENC_CLASS}]/;
    while (/($re)/g) {
      printf("%s:%d:%d: control byte 0x%02X\n", $ARGV, $., pos($_), ord($1));
    }
  ' "$f" 2>/dev/null)"
  if [ -n "$hits" ]; then
    printf '%s\n' "$hits" >&2
    bad=1
  fi

  # Second check: literal backslash-n inside a workflow `run:` block. Scoped to
  # workflow YAML only -- a `run:` key means "shell body" there; elsewhere it may
  # be an ordinary field. The scan walks run: block scalars (`|`/`>`) and
  # single-line `run:` values, and flags <whitespace>\n (a stripped ' \' line
  # continuation) while leaving format-string escapes (printf '%s\n') untouched.
  case "$f" in
    */.github/workflows/*.yml|*/.github/workflows/*.yaml|.github/workflows/*.yml|.github/workflows/*.yaml)
      run_hits="$(perl -e '
        my $in_block = 0;
        my $bi = -1;
        while (my $l = <>) {
          chomp $l;
          my ($lead) = $l =~ /^([ \t]*)/;
          my $indent = length $lead;
          if ($in_block) {
            if ($l =~ /^[ \t]*$/ || $indent > $bi) {
              if ($l =~ /([ \t]\\n)/) {
                printf("%s:%d:%d: literal backslash-n in run: block (a stripped shell line continuation)\n", $ARGV, $., $-[0] + 2);
              }
              next;
            }
            $in_block = 0;
          }
          if ($l =~ /^([ \t]*)run:[ \t]*[|>][-+0-9]*[ \t]*(?:#.*)?$/) {
            $bi = length $1;
            $in_block = 1;
          } elsif ($l =~ /^([ \t]*)run:[ \t]+\S.*$/) {
            if ($l =~ /([ \t]\\n)/) {
              printf("%s:%d:%d: literal backslash-n in run: block (a stripped shell line continuation)\n", $ARGV, $., $-[0] + 2);
            }
          }
        }
      ' "$f" 2>/dev/null)"
      if [ -n "$run_hits" ]; then
        printf '%s\n' "$run_hits" >&2
        bad_run=1
      fi
      ;;
  esac
done <<< "$files"

if [ "$bad" -ne 0 ]; then
  echo "::error::check-source-encoding: control bytes found in tracked source (see above). These are invisible in normal output and survive lint, typecheck and tests. Write the character as a source escape instead of embedding the raw byte." >&2
fi

if [ "$bad_run" -ne 0 ]; then
  # printf, not echo: the message shows a literal backslash, and echo's handling
  # of backslashes is implementation-defined (shellcheck SC2028).
  printf '%s\n' "::error::check-source-encoding: literal backslash-n found in run: block (see above). A shell line continuation (' \\' + newline) was collapsed into the two characters '\\' 'n', joining separate command lines into one run-on line. YAML parses it fine and lint never sees it -- only this byte check does. Restore the real line continuation." >&2
fi

if [ "$bad" -ne 0 ] || [ "$bad_run" -ne 0 ]; then
  exit 1
fi

echo "check-source-encoding: ${scanned} file(s) scanned, no control bytes outside TAB/LF, no literal backslash-n in run: blocks"
