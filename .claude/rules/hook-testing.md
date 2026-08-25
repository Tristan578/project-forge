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

# Lint the review-loop hooks this gate owns — zero findings required, and the CI
# `hook-tests` job (.github/workflows/ci.yml) runs exactly this. Newly added or
# edited hooks MUST be shellcheck-clean.
shellcheck \
  .claude/hooks/reject-incomplete-review.sh \
  .claude/hooks/review-quality-gate.sh \
  .claude/hooks/__tests__/reject-incomplete-review.test.sh \
  .claude/hooks/__tests__/review-quality-gate.test.sh

# Linting the WHOLE tree still surfaces ~10 pre-existing findings across 8 older
# hooks (tracked in #8676). Scope shellcheck to the files you touched until that
# cleanup lands rather than treating the legacy debt as a regression:
#   shellcheck .claude/hooks/*.sh .claude/hooks/__tests__/*.test.sh
```

Each suite is a self-contained bash script that exits non-zero if any case fails
(no bats dependency — bats is not installed). See
`.claude/hooks/__tests__/reject-incomplete-review.test.sh` as the canonical
pattern. CI runs every `*.test.sh` under `.claude/hooks/__tests__/` via the
path-gated `hook-tests` job whenever `.claude/hooks/**` changes, so a regression
in a hook's exit-code contract fails the PR instead of silently shipping.

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
