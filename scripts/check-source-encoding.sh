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
done <<< "$files"

if [ "$bad" -ne 0 ]; then
  echo "::error::check-source-encoding: control bytes found in tracked source (see above). These are invisible in normal output and survive lint, typecheck and tests. Write the character as a source escape instead of embedding the raw byte." >&2
  exit 1
fi

echo "check-source-encoding: ${scanned} file(s) scanned, no control bytes outside TAB/LF"
