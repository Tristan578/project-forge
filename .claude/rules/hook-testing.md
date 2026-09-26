---
description: Conventions for the bash test suites under .claude/hooks/__tests__ - exit-code contracts, fixture seams, self-re-exec anti-tamper, and extending a seam suite
paths:
  - ".claude/hooks/**"
---

# Testing Hooks (`.claude/hooks/__tests__/`)

Hooks with non-trivial logic (verdict gates, deferred-fix detection, metadata
checks) get a co-located bash test next to the hook under `.claude/hooks/__tests__/`.
A hook silently exiting the wrong code is a hard-to-spot failure — a SubagentStop
gate that loops, or a PreToolUse gate that blocks valid work — so these are tested
like any other code, TEST-FIRST.

## Running hook tests

```bash
# A single hook's suite
bash .claude/hooks/__tests__/reject-incomplete-review.test.sh

# All hook test suites
for t in .claude/hooks/__tests__/*.test.sh; do echo "== $t =="; bash "$t" || break; done

# Lint every hook and every suite — zero findings required. The whole tree is
# shellcheck-clean (#8676) and the CI `hook-tests` job
# (.github/workflows/ci.yml, step "Shellcheck all hooks") runs exactly this
# command, so a red result here IS your regression:
shellcheck -x .claude/hooks/*.sh .claude/hooks/__tests__/*.test.sh
# Plain `shellcheck` (no -x) is clean too: every dynamic `source` line carries a
# line-level `# shellcheck disable=SC1091` with its reason, because a
# `# shellcheck source=` directive is honoured only under -x.
```

Each suite is a self-contained bash script that exits non-zero if any case fails
(no bats dependency — bats is not installed). See
`.claude/hooks/__tests__/reject-incomplete-review.test.sh` as the canonical
pattern. CI runs every `*.test.sh` under `.claude/hooks/__tests__/` via the
path-gated `hook-tests` job whenever `.claude/hooks/**` changes, so a regression
in a hook's exit-code contract fails the PR instead of silently shipping.

Because that job is path-gated, it can go many PRs without running. So
`.github/workflows/hook-tests-scheduled.yml` also runs every suite, plus the same
ShellCheck scope, at 09:00 UTC every Monday, and you can run it by hand with
`workflow_dispatch`. A scheduled failure opens one tracking issue, or comments
on the one already open, with the run URL. Treat that issue as a regression in
`main`, not as noise. It exists because two real hook defects built up unseen
over 25+ CI runs in which the gated job never ran (#9606).

## Writing a hook test

- Drive the hook through its real contract: build the JSON payload (Edit/Write
  hooks read `TOOL_INPUT_*` env vars; Stop/SubagentStop/Bash hooks read stdin
  JSON) with `jq -nc --arg ...`, pipe it to `bash "$HOOK"`, and assert on `$?`.
  Exit 0 = allow/continue, exit 2 = block — those two codes ARE the behavior, so
  assert on them directly.
- Cover the boundary, the fail-safe, and the "looks-like-but-isn't" cases, not
  just the happy path — e.g. exact length thresholds, malformed/non-JSON stdin
  (must fail safe, never propagate a `jq` error code through `set -e`), and
  word-boundary near-misses (`PASSED` is not the `PASS` verdict).
- Guard host assumptions at the top (`command -v jq` etc.) so a missing tool
  reports clearly instead of every case failing.
- A hook test that needs to verify negative cases against a file the hook reads
  (not stdin/env args) needs a fixture seam: an env override defaulting to the
  real file, e.g. `FOO="${FOO_FILE:-$HERE/../../real.json}"`. NEVER set the
  override in CI — it must be paired with an in-suite self-defense assertion
  that greps both `.github/workflows/` and (if present) `.github/actions/` for
  the seam name(s) AND the self-re-exec seam literals (`--selftest-child`,
  `BASH_ENV` — BASH_ENV names a script that bash sources before every
  non-interactive invocation, so controlling it means executing arbitrary
  code before the script body runs), comment-stripped (a full-comment
  mention doesn't count as wired), fail-closed on a missing/unreadable dir
  AND on grep scan errors
  (exit >= 2), plus a runtime assertion — hoisted OUT of any recursion-guarded
  block so it evaluates on every non-child invocation, not only a top-level
  one — that fails if the override is ever set AT ALL, unconditionally. Do
  NOT scope this to `CI` being set: `CI` detection is itself
  attacker/misconfiguration-controlled (a bare `CI=` empty assignment in a
  workflow env block would silently neuter a CI-scoped version of this
  check), so the runtime assertion must fire regardless of `CI`. It catches
  wiring no static grep could see, e.g. a composite action exporting the
  override via `$GITHUB_ENV`. Consume the seam itself via self-re-exec:
  re-invoke the suite (`bash "${BASH_SOURCE[0]}" --selftest-child`) with the
  override pointed at a jq-mutated bad fixture, gating the negative-coverage
  block on an **argv flag** (`[ "${1:-}" != "--selftest-child" ]`), never an
  env var — an env-var recursion guard (e.g. a bare `_SELFTEST=1`) is
  spoofable via `$GITHUB_ENV` and would let CI-side tampering neuter the
  negative-path self-tests. An argv flag RAISES the cost of that tampering;
  it does NOT close the vector outright — it isn't itself settable via
  `$GITHUB_ENV`, but a workflow env block wiring `BASH_ENV` is sourced by
  non-interactive bash before the suite body runs, and that sourced script
  could `set -- --selftest-child` to rewrite positional parameters. This is
  a strictly more conspicuous, `BASH_ENV`-class arbitrary-code-exec
  primitive, and it is itself caught by the widened static scan above (same
  register as the `check-ci-success.sh` anti-tamper language in
  `gotchas.md`: raises cost, doesn't claim to be airtight).

  The argv gate also leaves a hole in the reverse direction: a top-level
  `bash <suite> --selftest-child` satisfies the flag with no parent,
  silently skipping the whole negative-coverage block and exiting 0. So
  the runtime assertion needs four branches, mirroring the code's own
  if/elif/elif/else order:

  1. tampered top-level (no child flag, either seam var wired) → must FAIL
  2. legitimate child (child flag + fixture seam present) → ok
  3. orphan child (child flag, no fixture seam) → must FAIL
  4. clean top-level (neither flag nor seam) → ok

  Branch 3 closes the reverse hole above: the flagged arm must
  additionally prove parentage (the spawner helper is the only
  legitimate source of the flag and always sets the override, so a
  flagged invocation WITHOUT the override is an orphan), and the orphan
  case must FAIL. Give that arm its own regression probe: spawn a bare
  flagged child with the override unset and assert that the orphan case
  must FAIL.

  Assert on the child's exit code AND that its captured output contains
  the specific FAIL
  message the hook emits, anchored to the FAIL line specifically (e.g. grep
  `FAIL <substr>`, not a bare substring) — both `ok` and `FAIL` lines can
  print the same descriptive text, so an unanchored grep is vacuous (a bare
  nonzero exit doesn't prove *which* check failed, and an unanchored match
  can pass against the wrong line). See `settings-permissions.test.sh`'s
  `SETTINGS_PERMISSIONS_FILE`/`--selftest-child` seam for the canonical
  example (round 3-8 hardening, PF-853) — the runtime assertion there also
  covers the legacy `SETTINGS_PERMISSIONS_SELFTEST` env-var name so a
  scan/assertion widened for one seam variant doesn't miss the other. Same
  scan pattern as the `$NPM_AUDIT_CMD`/`$GHAW_COMPILE_CMD`/`$NATIVE_BINDINGS_*`
  seams in scripts land.

## Extending fixture-seam tests

Covering a new settings field in a fixture-seam suite requires updating
three constructs in lockstep — add one without the others and the gap is
silent:

1. Add the positive assertion in the `assert_jq` block (the guard's
   expected-value check against the good fixture).
2. Add the mutated fixture via the `make_bad_fixture` block (one field
   broken, all others intact).
3. Add the rejection test via the `assert_child_rejects` block — the
   `expect_substr` MUST match the exact text of the FAIL line the child
   prints for that guard (the helper greps `FAIL <substr>`; a substring
   that only appears on an `ok` line will never match).

## Function freezes (#9125)

Every top-level function a suite defines — `pass`, `fail`, `ok`, `bad`, every
fixture builder — gets `readonly -f <name>` on the line DIRECTLY after its
closing brace:

```bash
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }
readonly -f fail
run_hook() {
  ...
}
readonly -f run_hook
```

A bash function resolves by name at call time, so without the freeze one
inserted `fail() { :; }` turns every FAIL into silence and the suite exits 0
having checked nothing (measured on main at a525ca4a: 46 of the 52 suites with a
`fail`/`bad` helper, all but the 6 already frozen). With it,
bash refuses the rebind and the real helper keeps running.

`scripts/check-fn-freeze.sh` (run by `lockfile-sync-tests` in `ci.yml`, after
its own suite) derives every column-0 definition and fails on one whose next
line is not its freeze, on a stray freeze (before the definition, after a blank
line, inside a quoted program or heredoc fixture, or naming a function the file
never defines), and fail-closed on a file
it cannot lex to EOF. Rules that follow from `readonly -f` itself:

- It cannot pre-declare, so no freeze block at the end of the file — each freeze
  follows its own definition, with no blank line between.
- Nested (indented) definitions are not frozen: a function defined inside a body
  that runs twice would be refused on the second run. Define helpers at the top
  level.
- Initialise counters (`FAILURES=0`) BEFORE the helpers, so a failure recorded
  early cannot be reset by the counter's own assignment. The gate does not
  guard the counter: a later write to it by any route (a plain assignment, an
  arithmetic reset, or a trap action such as `trap 'FAILED=0' RETURN` under
  `set -o functrace`) is for review to catch.
- A `fail()` you redefine on purpose inside `bash -c '...'` (a child process, as
  `platform-contract.test.sh` does) is unaffected — the freeze lives in the
  parent shell only.
- No `alias NAME=` and no `shopt -s expand_aliases` anywhere in a suite: an
  alias is resolved before functions and `readonly -f` does not stop it. The
  gate tokenises executable text the way bash does (quotes removed, escapes
  and continuations resolved; inside double quotes a backslash escapes only
  `$`, a backtick, `"`, `\` or a newline and is kept before anything else,
  so `"al\ias"` is the command `al\ias`, round thirty-two), finds each
  statement's command word, and when
  it is `alias` reports every later `NAME=` word, or `expand_aliases` after
  `shopt` plus an `s` flag — so `\alias`, `"alias"`, `\a\l\i\a\s`,
  `alias nothing fail=:` and anything in front of the word are all caught.
  Every command name and argument is also judged with its expansions
  removed, because each can expand to nothing (`$()`, `$(true)`, backticks,
  `${x:+Q}`, an unset `$1`), so `ali$()as`, `ali${x:+Q}as` and `shopt -$()s
  expand_aliases` are caught too, and an ANSI-C quoted string is decoded
  first (`$'\141lias'` is `alias`). A `$"..."` locale string is its text,
  and a word with brace groups is judged as every word it expands to
  (`al{i,}as`, `{a..a}lias`, `alias {x,fail=:}`); one longer than the gate
  enumerates, in a guarded position (a command name, or any word of an
  alias, shopt, set or trap statement), is itself a violation. Text written
  inside a parameter expansion (`${n:-alias}`, `${HOME:+alias}`,
  `${x/*/alias}`) is judged both with and without it, and such text holding
  a blank, which bash splits into words, is a `split` violation in a guarded
  position. A quoted or escaped brace inside the group does not end it
  (`${x:-"}"}`), and neither does one inside a `$( )` or backtick span in
  the operand (`${x:-$(echo }) alias}`). The operand itself is not parsed:
  every text after a `-`, `=`, `+` or `/` in the group is a candidate, so
  neither an escaped or quoted slash in a replacement pattern
  (`${x/a\/b/alias}`) nor a bracket inside a nested expansion in an array
  subscript (`${a[${y:-0]0}]:-alias fail=:}`) can hide the boundary
  (rounds twenty-seven and twenty-eight). A group is read one line at a
  time, so an unquoted one whose closing brace is on a later line is a
  `multiline` violation wherever it stands (round thirty). Only a variable value or a command output that must contribute
  text to spell the word (`al$(echo i)as`), `eval`, a `source` of a file the
  suite wrote, and `declare -n` stay out of reach. The word
  as an argument (`echo alias fail=:`), inside a quoted string
  that holds more than the word, in a heredoc fixture or in a comment is text.
- No posix mode either: it turns `expand_aliases` on as a side effect (bash
  5.2: `set -o posix` alone makes `shopt -p expand_aliases` print `-s`). The
  gate reports `set` with an `o` flag cluster before `posix` (`set -o posix`,
  `set -eo posix`, until `--` or `-` ends the options), `shopt -s -o posix`,
  and ANY word naming `POSIXLY_CORRECT`, text included: assigning it enters
  posix mode from more positions than a list would stay complete for
  (`POSIXLY_CORRECT=1 :`, `export`, `declare`, `printf -v`, `read`,
  `${POSIXLY_CORRECT:=1}`, an array `POSIXLY_CORRECT=(1)` or a name inside
  any array literal). A `$( )` inside a `set` statement does not hide it. A suite that must print the name builds it from
  an expansion (`"${head}_CORRECT"`), as `check-fn-freeze.test.sh` does.
- No `trap ... DEBUG` and no `shopt -s extdebug` either: with extdebug on, a
  DEBUG trap that returns non-zero makes bash skip the next command, so every
  `fail "..."` call can be made to vanish with the function still frozen. Same
  tokeniser, same rule (the word `DEBUG` in any case after a `trap` command
  word; `extdebug` after `shopt` plus an `s` flag), with the same expansion
  removal, which also applies to a trap's signal words and, since bash parses
  it again when the trap fires, to its action (`trap 'ex$()it 0' EXI$()T`).
  A trap on EXIT, ERR,
  RETURN or 0 whose action exits or execs is one too — `trap 'exit 0' EXIT`
  overrides the `exit 1` the suite reached; a numeric signal is judged by its
  value, since bash reads it as a signed decimal between blanks (any
  whitespace before; after it, a space or tab in Linux bash, and a newline
  too in the Git Bash on the Windows runner, so the gate takes any whitespace
  there), so `00`, `+0`, `-0`, `' 00'`, `'0 '` and `$'0\n'` are all 0 — and
  so is one whose action calls
  a function of the same file that exits or execs, directly or through another
  function (`cleanup() { exit 0; }` + `trap cleanup EXIT`), while a cleanup
  EXIT trap whose functions never exit, a
  trap on a real signal (`trap 'exit 143' TERM`), `trap - ERR` and
  `shopt -u extdebug` are not violations.
- No function named after a bash builtin, at any depth, and no `enable`: a
  `readonly() { return 0; }` makes every later freeze a no-op, an `exit()` or
  `test()` that returns 0 makes the final verdict a no-op, and `enable -n
  readonly` switches the builtin off. The name set is derived from
  `compgen -b` in the bash that runs the gate, never listed by hand; the
  names as arguments or in strings are text.
- The body is a brace group, opened on the definition line or the next
  non-blank, non-comment line, closed by `}` at column 0 (or on the same line
  for a one-liner; a trailing comment is not part of it). A one-liner ends
  where its `}` stands in command position, as bash reads it, whatever code
  follows (`f() { :; }; true` is a one-liner), and a `}` that is only an
  argument (`f() { echo }`) closes nothing, so the next line is still the
  body (round thirty-two). The word after `fi`, `done` or `esac` is in
  command position, so `h() { if true; then :; fi }` closes on its line
  (round thirty-three). A multi-line body whose brace closes anywhere but
  column 0 (an indented `}`), or never, is reported as `close` (round
  thirty-five). A subshell body or a
  bare compound body is reported as `unsupported` — the gate never skips a
  definition it cannot follow.
- Every function at true top level (outside any function body, subshell,
  loop or `if`/`case` arm, counted by command word, not indentation; a case
  pattern, extglob groups included, or a quoted `"{"` is not a command word)
  is
  defined at column 0, at the start of its own line, with a
  plain identifier name. Anything else at top level — indented, after another
  command or a closing brace, second on a line (even under the same name), a
  dashed name — is reported as `shape`, because
  the freeze rule cannot tie it to a freeze line. A bare brace group
  `{ ...; }` runs once and unconditionally, so it is top level too: a
  definition inside one is reported, while one inside a function body brace
  is not (round thirty-three; case 30t pins each spelling of the body,
  indented, because a column-0 body is excluded before its nesting is read).
- `<<` inside `(( ))`, `$(( ))` or the deprecated `$[ ]` is a shift operator,
  not a heredoc.
- A heredoc delimiter is any word (`<<1EOF`, `<<-ZEOF`, `<<'.EOF'`), and a
  column-0 definition inside a multi-line `( )` or `$( )` is subshell-local,
  not a top-level helper.
- Heredocs follow bash: only `<<-` strips leading tabs before the terminator;
  a plain `<<` body runs to the column-0 delimiter, tab-indented lookalikes
  included.

## Platform contract (#9611)

Suites run on Linux AND on Windows (Git Bash, `hook-tests-windows` in `ci.yml`).
Source `scripts/__tests__/lib/platform.sh` rather than writing a private skip
helper:

- `unsupported_on <platform> <reason>` — the thing UNDER TEST cannot run here.
  Prints `UNSUPPORTED on <platform>: …` and exits **3**. The Windows job counts
  and warns on 3; anything else non-zero fails it. Never print a success line
  after this.
- `probe_skip <reason>` — a host-capability gap that is NOT the thing under test
  (a probe fixture could not be planted). Prints `SKIP: …`; under `CI=true` it
  calls the suite's own `fail`/`bad`, so coverage may thin out on a laptop and
  never on the runner.
- Shell sources are `eol=lf` in `.gitattributes` and `check-source-encoding.sh`
  rejects a CR in `*.sh`/`*.bash`: a CRLF checkout dies at the shebang.
- Call Python through a resolver (`command -v python3 || command -v python`):
  CPython for Windows ships `python.exe`.
