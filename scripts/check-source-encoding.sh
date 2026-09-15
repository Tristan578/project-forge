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
# TAB and LF are permitted. CR is also permitted in non-shell source files;
# shell sources reject CR because it breaks execution. Other C0 bytes
# are written as an escape (`\0`, `\t`) -- which is
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

# Conservative additional heuristic for collapsed shell continuations in plain
# workflow step run values. This does not parse all YAML or shell syntax:
# quoted/anchored/flow YAML values are explicitly unexamined, and quoted shell
# text (including command substitutions inside it) and heredoc bodies are opaque.
# The current tree and focused mutation fixtures must remain clean.
command -v perl >/dev/null 2>&1 || { echo "::error::check-source-encoding requires perl" >&2; exit 1; }

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
  ' "$f")" || { echo "::error::control-byte scanner failed for $f" >&2; exit 1; }
  if [ -n "$hits" ]; then
    printf '%s\n' "$hits" >&2
    bad=1
  fi

  # Additional bounded heuristic for supported workflow run text. Opaque
  # YAML values and shell quoting are excluded, not claimed as validated.
  case "$f" in
    */.github/workflows/*.yml|*/.github/workflows/*.yaml|.github/workflows/*.yml|.github/workflows/*.yaml)
      run_hits="$(perl -e '
        # This is a conservative lexer, not a YAML or shell parser. Only plain
        # step run keys and literal/folded scalars are examined. Quotes,
        # comments, heredocs and opaque YAML scalars are not shell evidence.
        my ($steps, $step, $block, $opaque) = (-1, -1, -1, -1);
        my ($quote, $shell_opaque) = ("", 0);
        my $body_indent;
        my $folded = 0;
        my $yaml_quote = "";
        my $plain_run_continuation = 0;
        my @heredocs;
        my ($checked, $excluded) = (0, 0);
        sub exclude {
          my ($reason) = @_;
          ++$excluded;
          print STDERR "$ARGV:$.: unexamined run text: $reason\n";
        }
        sub reset_shell { $quote = ""; $shell_opaque = 0; @heredocs = (); }
        sub scan_shell {
          my ($line, $offset) = @_;
          return if $shell_opaque;
          if (@heredocs) {
            my $body = $line;
            $body =~ s/^\t+// if $heredocs[0][1];
            shift @heredocs if $body eq $heredocs[0][0];
            return;
          }
          for (my $i = 0; $i < length($line); ++$i) {
            my $c = substr($line, $i, 1);
            if ($quote ne "") {
              if ($c eq "\\" && $quote ne chr(39)) { ++$i; next; }
              $quote = "" if $c eq $quote;
              next;
            }
            # A shell comment starts at a word boundary, not in foo#bar.
            if ($c eq "#" && ($i == 0 || substr($line, $i-1, 1) =~ /[\s;|&()]/)) {
              if ($folded) { exclude("folded scalar comment; remainder not examined"); $shell_opaque = 1; }
              last;
            }
            if ($c eq chr(39) || $c eq "\"" || $c eq chr(96)) { $quote = $c; next; }
            if (substr($line, $i, 2) eq "<<") {
              # Here-strings are ordinary shell words, not heredocs.
              if (substr($line, $i, 3) eq "<<<") { $i += 2; next; }
              pos($line) = $i;
              if ($line =~ /\G<<(-?)[ \t]*(?:\x27([^\x27]+)\x27|"([^"]+)"|([A-Za-z_][A-Za-z_0-9]*))(?=[ \t;|&)]|$)/gc) {
                push @heredocs, [defined($2) ? $2 : defined($3) ? $3 : $4, $1 eq "-"];
                $i = pos($line) - 1;
                next;
              }
              exclude("unsupported heredoc delimiter; remainder of this run not examined");
              $shell_opaque = 1;
              return;
            }
            if ($c eq "\\") {
              if ($i > 0 && substr($line, $i-1, 1) =~ /[ \t]/ && substr($line, $i+1, 1) eq "n") {
                printf("%s:%d:%d: suspicious unquoted literal backslash-n in run text\n", $ARGV, $., $offset + $i + 1);
              }
              ++$i; # Escaped quote/backslash cannot change lexical state.
            }
          }
        }
        sub close_yaml_quote {
          my ($text) = @_;
          for (my $i = 0; $i < length($text); ++$i) {
            my $c = substr($text, $i, 1);
            if ($yaml_quote eq "\"" && $c eq "\\") { ++$i; next; }
            if ($c eq $yaml_quote) {
              if ($yaml_quote eq chr(39) && substr($text, $i+1, 1) eq chr(39)) { ++$i; next; }
              $yaml_quote = "";
              last;
            }
          }
        }
        while (my $l = <>) {
          chomp $l;
          $l =~ s/\r$//;
          if ($yaml_quote ne "") { close_yaml_quote($l); next; }
          my ($lead) = $l =~ /^([ ]*)/;
          my $indent = length $lead;
          if ($block >= 0) {
            if ($l =~ /^[ \t]*$/ || $indent > $block) {
              # YAML strips the common body indentation. Keep relative
              # indentation so only exact heredoc terminators close a body.
              if (!defined $body_indent && $l !~ /^[ \t]*$/) { $body_indent = $indent; }
              my $cut = defined($body_indent) ? $body_indent : 0;
              scan_shell(substr($l, $cut), $cut);
              next;
            }
            $block = -1;
          }
          if ($opaque >= 0) {
            if ($l =~ /^[ \t]*$/ || $indent > $opaque) {
              if ($plain_run_continuation && $l !~ /^[ \t]*$/) {
                exclude("multiline plain run continuation; folding not examined");
                $plain_run_continuation = 0;
              }
              next;
            }
            $opaque = -1;
            $plain_run_continuation = 0;
          }
          next if $l =~ /^[ \t]*(?:#.*)?$/;
          if ($steps >= 0 && $indent <= $steps && $l !~ /^[ ]*-/) { $steps = -1; $step = -1; }
          if ($l =~ /^([ ]*)steps:[ \t]*(?:#.*)?$/) {
            $steps = length($1); $step = -1; next;
          }
          if ($steps >= 0 && $l =~ /^([ ]*)-[ \t]+/) {
            my $candidate = length($1);
            $step = $candidate if $step < 0;
          }
          my ($key, $value);
          if ($steps >= 0 && $step >= 0) {
            if ($l =~ /^([ ]*)-[ ]+run:[ \t]*(.*)$/ && length($1) == $step) {
              $key = index($l, "run:"); $value = $2;
            } elsif ($l =~ /^([ ]*)run:[ \t]*(.*)$/ && length($1) == $step + 2) {
              $key = length($1); $value = $2;
            }
          }
          if (defined $value) {
            reset_shell();
            $folded = 0;
            if ($value =~ /^[|>](?:[+-]?[1-9]?|[1-9][+-]?)[ \t]*(?:#.*)?$/) {
              $block = $key;
              $folded = substr($value, 0, 1) eq ">";
              $body_indent = undef;
              ++$checked;
              next;
            }
            if ($value eq "" || $value =~ /^[\x27"!&*{\[]/) {
              exclude("quoted, empty, tagged, anchored or flow YAML value");
              $opaque = $key;
            } else {
              ++$checked;
              scan_shell($value, length($l) - length($value));
              # Multiline plain YAML values require folding; do not guess.
              $opaque = $key;
              $plain_run_continuation = 1;
            }
          } elsif ($l =~ /(?:^|[ {,])(?:\x27run\x27|"run"|run)[ \t]*:/) {
            exclude("run key outside the supported plain step mapping");
          }
          # Quoted YAML data may span physical lines regardless of apparent
          # run/steps text inside it. Do not interpret that text as mappings.
          if ($l =~ /:[ \t]*([\x27"])/) {
            $yaml_quote = $1;
            close_yaml_quote(substr($l, $+[0]));
          }
          # Any other block scalar is opaque YAML data. A run-looking line
          # inside env values, descriptions or embedded documents is not a step.
          if ($l =~ /:[ \t]*[|>](?:[+-]?[1-9]?|[1-9][+-]?)[ \t]*(?:#.*)?$/) {
            $opaque = $indent;
          }
        }
        print STDERR "$ARGV: examined $checked supported run value(s); $excluded unexamined form(s). Heuristic only; not full YAML/shell validation.\n";
      ' "$f")" || { echo "::error::workflow scanner failed for $f" >&2; exit 1; }
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
  printf '%s\n' "::error::check-source-encoding: suspicious unquoted literal backslash-n in supported run text (see above). Review for a collapsed shell continuation; use a real continuation or quote intentional literal text. This heuristic does not validate all YAML or shell forms." >&2
fi

if [ "$bad" -ne 0 ] || [ "$bad_run" -ne 0 ]; then
  exit 1
fi

echo "check-source-encoding: ${scanned} file(s) scanned, no prohibited control bytes, no suspicious unquoted backslash-n in examined run text (unsupported forms reported separately)"
