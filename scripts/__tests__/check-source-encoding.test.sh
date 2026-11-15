#!/usr/bin/env bash
# Contract test for scripts/check-source-encoding.sh.
#
# The gate's whole value is catching bytes that are invisible everywhere else,
# so the fixtures below embed real control bytes rather than describing them.
# They are built with printf at runtime; committing a corrupt fixture would trip
# the gate this suite is testing.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../check-source-encoding.sh"

PASS=0
FAIL=0
pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
readonly -f pass
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }
readonly -f fail

[ -f "$SCRIPT" ] || { echo "script not found: $SCRIPT"; exit 1; }

# Run the gate against one fixture file whose bytes are produced by printf.
# $1 = printf format producing the file's content. Returns "<output>|<rc>".
run_on() {
  local content_fmt="$1" ext="${2:-ts}"
  local dir out rc
  dir="$(mktemp -d)"
  # shellcheck disable=SC2059  # the format IS the fixture under test
  printf "$content_fmt" > "$dir/fixture.$ext"
  printf '%s\n' "$dir/fixture.$ext" > "$dir/list"
  out="$(SOURCE_ENCODING_FILE_LIST="$dir/list" bash "$SCRIPT" 2>&1)" && rc=0 || rc=$?
  rm -rf "$dir"
  printf '%s|%s' "$out" "$rc"
}
readonly -f run_on
rc_of() { printf '%s' "${1##*|}"; }
readonly -f rc_of

# Run the gate against one fixture WORKFLOW file, placed under a real
# .github/workflows/ path so the run:-block check's path scoping matches it.
# $1 = printf format producing the workflow's content. Returns "<output>|<rc>".
run_on_workflow() {
  local content_fmt="$1"
  local dir out rc
  dir="$(mktemp -d)"
  mkdir -p "$dir/.github/workflows"
  # shellcheck disable=SC2059  # the format IS the fixture under test
  if [ "${2:-}" = literal ]; then
    printf '%s' "$content_fmt" > "$dir/.github/workflows/fixture.yml"
  else
    printf "$content_fmt" > "$dir/.github/workflows/fixture.yml"
  fi
  printf '%s\n' "$dir/.github/workflows/fixture.yml" > "$dir/list"
  out="$(SOURCE_ENCODING_FILE_LIST="$dir/list" bash "$SCRIPT" 2>&1)" && rc=0 || rc=$?
  rm -rf "$dir"
  printf '%s|%s' "$out" "$rc"
}
readonly -f run_on_workflow

# A CRLF shell source dies at its shebang (`$'\r': command not found`) on every
# platform the suites run on; a Windows checkout with core.autocrlf=true
# produces exactly that (#9611). CR stays tolerated in other files.
RES="$(run_on 'echo hi\r\n' sh)"
if [ "$(rc_of "$RES")" -ne 0 ] && grep -q '0x0D' <<<"$RES"; then
  pass "a CR (0x0D) in a .sh file is rejected and named"
else
  fail "a CRLF shell script passed the gate — on Windows every suite would die at the shebang: $RES"
fi
RES="$(run_on 'echo hi\r\n' bash)"
if [ "$(rc_of "$RES")" -ne 0 ]; then
  pass "a CR in a .bash file is rejected too"
else
  fail "a CRLF .bash file passed the gate"
fi
RES="$(run_on 'const a = 1;\r\n' ts)"
if [ "$(rc_of "$RES")" -eq 0 ]; then
  pass "a CR in a non-shell file is still tolerated (only shell sources gained the CR rule)"
else
  fail "the CR rule leaked into non-shell files: $RES"
fi

echo "=== control bytes must be rejected ==="

# The exact byte that made a MIME regex match nothing while every test passed.
RES="$(run_on 'const re = /^application\\/wasm\bx/;\n')"
if [ "$(rc_of "$RES")" != "0" ]; then
  pass "a BACKSPACE (0x08) inside a regex is rejected (exit $(rc_of "$RES"))"
else
  fail "a backspace byte passed -- this is the bug the gate exists for"
fi
if grep -q "0x08" <<<"$RES"; then
  pass "the report names the byte in hex"
else
  fail "the report did not identify the byte: $RES"
fi
if grep -qE "fixture\.ts:1:[0-9]+" <<<"$RES"; then
  pass "the report gives file, line and column (actionable without cat -A)"
else
  fail "the report lacks a file:line:column locator: $RES"
fi

# A NUL is the dangerous case: it is what makes git call a file binary.
# shellcheck disable=SC2016  # single quotes are deliberate: this is a printf
# format producing fixture bytes, not shell to be expanded.
RES="$(run_on 'const sig = `a\0b`;\n')"
if [ "$(rc_of "$RES")" != "0" ]; then
  pass "a NUL (0x00) is rejected"
else
  fail "a NUL byte passed"
fi

# THE TRAP. A NUL in the first bytes makes git treat the file as binary, so an
# implementation enumerating with `git grep -I` would skip exactly this file --
# the worst case, silently. Scanning must not depend on git's binary heuristic.
RES="$(run_on '\0\0\0 const x = 1;\n')"
if [ "$(rc_of "$RES")" != "0" ]; then
  pass "a file whose NUL is in the FIRST bytes is still scanned and rejected (a git-grep -I implementation would skip it)"
else
  fail "a leading-NUL file was skipped -- the gate depends on git's binary heuristic, which this class of bug defeats"
fi

for spec in '0x0B:\v' '0x0C:\f' '0x1B:\033'; do
  code="${spec%%:*}"; esc="${spec##*:}"
  RES="$(run_on "const x = 'a${esc}b';\n")"
  if [ "$(rc_of "$RES")" != "0" ]; then
    pass "a ${code} byte is rejected"
  else
    fail "a ${code} byte passed"
  fi
done

echo ""
echo "=== legitimate whitespace must pass ==="

RES="$(run_on 'const a = 1;\n\tconst b = 2;\n\n')"
if [ "$(rc_of "$RES")" = "0" ]; then
  pass "TAB and LF pass (they are ordinary source whitespace)"
else
  fail "tabs or newlines were rejected: $RES"
fi

# A CR is left alone deliberately: this repo has Windows contributors and git
# handles line endings via .gitattributes. Flagging CR here would produce noise
# that has nothing to do with the corruption class being caught.
RES="$(run_on 'const a = 1;\r\n')"
if [ "$(rc_of "$RES")" = "0" ]; then
  pass "a CR is left alone (line endings are git's job, not this gate's)"
else
  fail "a CR was rejected -- that is line-ending policy, not control-byte corruption: $RES"
fi

echo ""
echo "=== a literal backslash-n in a workflow run: block must be rejected ==="

# THE CORRUPTION. A shell line continuation (' \' + newline) collapsed into the
# two characters '\' and 'n', joining two command lines into one run-on line.
# YAML still parses; shellcheck/lint never see it; only a byte check catches it.
# The '\\n' below is printf for a literal backslash-n; the surrounding '\n' are
# real newlines, so the fixture is a genuine one-line-run-on run: block.
CORRUPT='jobs:\n  build:\n    steps:\n      - name: shellcheck\n        run: |\n          shellcheck scripts/*.sh \\n            --severity=error\n'
RES="$(run_on_workflow "$CORRUPT")"
if [ "$(rc_of "$RES")" != "0" ]; then
  pass "a stripped ' \\' line continuation (literal \\n) in a run: block is rejected (exit $(rc_of "$RES"))"
else
  fail "a literal backslash-n in a run: block passed -- this is the exact corruption the check exists for: $RES"
fi
if grep -qE "fixture\.yml:[0-9]+" <<<"$RES"; then
  pass "the report names the workflow file and line"
else
  fail "the report lacks a file:line locator: $RES"
fi

# THE MUTATION PAIR. Remove the corruption -- restore a real ' \' + newline line
# continuation -- and the same fixture must go green.
CLEAN='jobs:\n  build:\n    steps:\n      - name: shellcheck\n        run: |\n          shellcheck scripts/*.sh \\\n          --severity=error\n'
RES="$(run_on_workflow "$CLEAN")"
if [ "$(rc_of "$RES")" = "0" ]; then
  pass "the same run: block with a real line continuation passes (red -> green mutation pair)"
else
  fail "a correctly-continued run: block was rejected: $RES"
fi

# NO FALSE POSITIVE on a legitimate escape. `printf "%s\n"` has \n glued to a
# non-whitespace char and is real shell -- it is everywhere in the workflows and
# must never be flagged, or the gate lands red and gets routed around.
# shellcheck disable=SC2016  # single quotes are deliberate: $body/$url are
# literal text in the fixture's shell body, not shell to be expanded here.
LEGIT='jobs:\n  build:\n    steps:\n      - name: print\n        run: |\n          printf "%%s\\n" "$body"\n          curl -sS -w "\\n%%{http_code}" "$url"\n'
RES="$(run_on_workflow "$LEGIT")"
if [ "$(rc_of "$RES")" = "0" ]; then
  pass "a legitimate printf/curl \\n (glued to a non-space, real shell) is not flagged"
else
  fail "a legitimate \\n escape in a run: block was flagged -- the gate would land red on the real tree: $RES"
fi

# SCOPE 1: the check is confined to run: blocks. A ' \n' inside an env: value
# (not shell) must not be scanned, or the check over-reaches into other keys.
ENVONLY='jobs:\n  build:\n    env:\n      GREETING: "hi \\n there"\n    steps:\n      - run: echo ok\n'
RES="$(run_on_workflow "$ENVONLY")"
if [ "$(rc_of "$RES")" = "0" ]; then
  pass "a backslash-n outside any run: block (an env: value) is not scanned (run:-block scoping holds)"
else
  fail "the check reached outside a run: block into another YAML key: $RES"
fi

# SCOPE 2: the run: check applies only to workflow YAML. A ' \n' in a .ts source
# is not the corruption class and must pass (it carries no control byte either).
RES="$(run_on 'const s = "a \\n b";\n' ts)"
if [ "$(rc_of "$RES")" = "0" ]; then
  pass "a backslash-n in a non-workflow file is left alone (run: check is workflow-scoped)"
else
  fail "the run:-block check leaked into non-workflow files: $RES"
fi

echo ""
echo "=== the gate must not pass vacuously ==="

# A gate that scans nothing and exits 0 reads as coverage while asserting
# nothing. That is the failure mode behind several bugs this milestone.
d="$(mktemp -d)"; : > "$d/empty-list"
out="$(SOURCE_ENCODING_FILE_LIST="$d/empty-list" bash "$SCRIPT" 2>&1)" && rc=0 || rc=$?
rm -rf "$d"
if [ "$rc" -ne 0 ]; then
  pass "an empty file list fails rather than reporting success (exit $rc)"
else
  fail "the gate reported success having scanned nothing: $out"
fi

d="$(mktemp -d)"
out="$(SOURCE_ENCODING_FILE_LIST="$d/does-not-exist" bash "$SCRIPT" 2>&1)" && rc=0 || rc=$?
rm -rf "$d"
if [ "$rc" -ne 0 ]; then
  pass "a missing file list is a usage error, not a verdict (exit $rc)"
else
  fail "a missing file list was tolerated"
fi

echo ""

echo "=== bounded workflow lexer regressions ==="
expect_workflow() {
  local label="$1" expected="$2" content="$3" result rc
  result="$(run_on_workflow "$content" literal)"
  rc="$(rc_of "$result")"
  if [ "$rc" = "$expected" ]; then pass "$label"; else fail "$label: $result"; fi
}
readonly -f expect_workflow
UNNAMED=$(cat <<'YAML'
jobs:
  build:
    steps:
      - run: |
          shellcheck scripts/*.sh \n --severity=error
YAML
)
expect_workflow "unnamed block detects collapsed continuation" 1 "$UNNAMED"
expect_workflow "unnamed CRLF block detects collapsed continuation" 1 "${UNNAMED//$'\n'/$'\r\n'}"
expect_workflow "folded/chomp block detects collapsed continuation" 1 "${UNNAMED/run: |/run: >-}"
expect_workflow "explicit indentation block detects collapsed continuation" 1 "${UNNAMED/run: |/run: |2-}"
expect_workflow "unnamed inline detects collapsed continuation" 1 "${UNNAMED/run: |$'\n'          /run: }"
NAMED="${UNNAMED/- run: /- name: scan$'\n'        run: }"
expect_workflow "named CRLF block detects collapsed continuation" 1 "${NAMED//$'\n'/$'\r\n'}"
expect_workflow "named inline detects collapsed continuation" 1 "${NAMED/run: |$'\n'          /run: }"
RESTORED="${UNNAMED/\\n /\\$'\n'          }"
expect_workflow "unnamed mutation restores real continuation" 0 "$RESTORED"

LEGIT_QUOTES=$(cat <<'YAML'
jobs:
  build:
    steps:
      - run: |
          printf 'hello \n'
          printf "hello \n"
          # a documented \n is not executable
          printf 'multiline
          quoted \n text'
          printf "escaped \" quote \n"
          cat <<'EOF'
          heredoc \n data
          EOF
          cat <<FIRST <<SECOND
          first \n data
          FIRST
          second \n data
          SECOND
          echo ok
YAML
)
expect_workflow "quotes comments and multiple heredocs are opaque" 0 "$LEGIT_QUOTES"
expect_workflow "detects corruption after quotes and heredocs close" 1 "$LEGIT_QUOTES"$'\n''          echo bad \n argument'
HERETAB=$(cat <<'YAML'
jobs:
  build:
    steps:
      - run: |
          cat <<-EOF
          <TAB>heredoc \n data
          <TAB>EOF
          echo bad \n argument
YAML
)
# Insert shell tabs at runtime so the YAML fixture keeps its intended indentation.
HERETAB="${HERETAB//<TAB>/$'\t'}"
expect_workflow "tab-stripped heredoc terminates before corruption" 1 "$HERETAB"
HERESTRING=$(cat <<'YAML'
jobs:
  build:
    steps:
      - run: |
          cat <<< "some text"
          echo bad \n argument
YAML
)
# A here-string (<<<) is an ordinary shell word, NOT a heredoc opener. Without
# the `<<<` special case in scan_shell the lexer mistakes it for a heredoc with
# an unsupported delimiter, marks the rest of the run opaque, and the gate goes
# GREEN on the collapsed continuation below (verified: deleting that one line
# makes this fixture exit 0 reporting "unsupported heredoc delimiter"). The
# corruption on the later line must still be caught and reported, not swallowed.
expect_workflow "here-string is not a heredoc opener; later corruption still caught" 1 "$HERESTRING"
RES="$(run_on_workflow "$HERESTRING" literal)"
if grep -q 'suspicious unquoted literal backslash-n' <<<"$RES" && ! grep -q 'unsupported heredoc delimiter' <<<"$RES"; then
  pass "the here-string run is scanned through, not swallowed as an unsupported heredoc"
else
  fail "a here-string was misparsed as a heredoc and the corruption was swallowed: $RES"
fi
OPAQUE=$(cat <<'YAML'
jobs:
  build:
    env:
      DATA: |
        steps:
          - run: |
              echo data \n remains data
    steps:
      - name: quoted yaml
        run: "printf 'hello \n'"
      - run: &command echo value \n data
      - run: |
          echo ok
YAML
)
expect_workflow "opaque YAML data and unsupported values never become shell findings" 0 "$OPAQUE"
RES="$(run_on_workflow "$OPAQUE" literal)"
if grep -q 'unexamined run text' <<<"$RES"; then
  pass "unsupported YAML forms are reported honestly"
else
  fail "unsupported YAML forms were silently claimed as covered: $RES"
fi
MULTILINE_YAML=$(cat <<'YAML'
jobs:
  build:
    env:
      DATA: "text
        steps:
          - run: echo data \n stays data
        end"
    steps:
      - run: echo ok
YAML
)
expect_workflow "multiline quoted YAML is opaque to step recognition" 0 "$MULTILINE_YAML"
MULTILINE_PLAIN=$(cat <<'YAML'
jobs:
  build:
    steps:
      - run: echo first
          echo data \n remains unexamined
YAML
)
RES="$(run_on_workflow "$MULTILINE_PLAIN" literal)"
if [ "${RES##*|}" -eq 0 ] && grep -q 'multiline plain run continuation' <<<"$RES"; then
  pass "multiline plain run continuations are disclosed as unexamined"
else
  fail "multiline plain run continuation was not disclosed: $RES"
fi

FOLDED_COMMENT=$(cat <<'YAML'
jobs:
  build:
    steps:
      - run: >
          echo ok # starts a folded shell comment
          documented \n text
YAML
)
expect_workflow "folded comments do not create false positives on following lines" 0 "$FOLDED_COMMENT"

# A helper failure must not be mistaken for an empty (clean) scanner result.
d="$(mktemp -d)"
mkdir -p "$d/bin" "$d/.github/workflows"
printf '%s\n' '#!/usr/bin/env bash' 'exit 9' > "$d/bin/perl"
chmod +x "$d/bin/perl"
printf '%s\n' 'jobs: {}' > "$d/.github/workflows/f.yml"
printf '%s\n' "$d/.github/workflows/f.yml" > "$d/list"
out="$(PATH="$d/bin:$PATH" SOURCE_ENCODING_FILE_LIST="$d/list" bash "$SCRIPT" 2>&1)" && rc=0 || rc=$?
rm -rf "$d"
if [ "$rc" -ne 0 ] && grep -q 'scanner failed' <<<"$out"; then
  pass "scanner execution errors fail the gate"
else
  fail "scanner execution failure was treated as clean: $out"
fi


# Fail only the second scanner: the first (-ne) must genuinely finish.
# Capture the real executable before introducing the wrapper into PATH.
real_perl="$(command -v perl)"
d="$(mktemp -d)"
mkdir -p "$d/bin" "$d/.github/workflows"
cat > "$d/bin/perl" <<'WRAPPER'
#!/usr/bin/env bash
if [ "${1:-}" = -e ]; then
  exit 9
fi
exec "$SOURCE_ENCODING_TEST_REAL_PERL" "$@"
WRAPPER
chmod +x "$d/bin/perl"
printf '%s\n' 'jobs: {}' > "$d/.github/workflows/f.yml"
printf '%s\n' "$d/.github/workflows/f.yml" > "$d/list"
out="$(PATH="$d/bin:$PATH" SOURCE_ENCODING_TEST_REAL_PERL="$real_perl" SOURCE_ENCODING_FILE_LIST="$d/list" bash "$SCRIPT" 2>&1)" && rc=0 || rc=$?
rm -rf "$d"
if [ "$rc" -ne 0 ] && grep -q 'workflow scanner failed' <<<"$out"; then
  pass "workflow scanner failure independently fails the gate"
else
  fail "workflow scanner failure was treated as clean or misidentified: $out"
fi

echo "=== the real tree is clean ==="
out="$(bash "$SCRIPT" 2>&1)" && rc=0 || rc=$?
if [ "$rc" -eq 0 ]; then
  pass "the tracked tree has no prohibited control bytes ($(grep -oE '[0-9]+ file' <<<"$out" | head -1))"
else
  fail "control bytes present in tracked source:"
  printf '%s\n' "$out" | head -10 | sed 's/^/      /'
fi

echo ""
echo "  PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "SUITE PASSED"
  exit 0
fi
echo "SUITE FAILED"
exit 1
