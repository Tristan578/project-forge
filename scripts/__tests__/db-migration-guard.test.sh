#!/usr/bin/env bash
# Unit tests for scripts/db-migration-guard.sh — the production schema-migration
# gate — plus structural assertions that the gate is actually wired into
# .github/workflows/cd.yml's deploy-production job and shellchecked/run by
# ci.yml's self-defense suite.
#
# WHY THIS GATE EXISTS (#9456)
# ----------------------------
# cd.yml mutates the PRODUCTION database with `drizzle-kit push` before the new
# code deploys. Reading node_modules/drizzle-kit/bin.cjs (`pgPush` at ~L82701)
# shows drizzle-kit's exit code carries no information:
#
#   * the whole body is `try { ... } catch (e) { console.error(e) }` with no
#     `process.exit(1)` — every failure still exits 0;
#   * the pg apply loop (`for (const dStmnt of statementsToExecute) { await
#     db.query(dStmnt) }`, ~L82768) has no transaction — a mid-apply failure
#     leaves production half-migrated;
#   * on a data-loss diff without --force it calls hanji `render(new Select(...))`,
#     which rejects when `!process.stdin.isTTY || !process.stdout.isTTY`
#     (~L1449) — i.e. always in CI — so the migration is SILENTLY SKIPPED and
#     the deploy proceeds against the old schema.
#
# The gate therefore classifies what pgPush PRINTED, and its exit code is the
# contract. Every branch below is pinned here: getting a classification wrong
# either blocks a safe deploy or, far worse, lets a DROP COLUMN reach production
# unattended.
#
# HERMETIC TESTING
# ----------------
# The gate performs no network and no database I/O — it reads one text file. So
# these tests need no seam at all: each case writes a fixture that reproduces a
# real drizzle-kit capture and asserts the verdict + exit code. Nothing here can
# touch Neon, Vercel, or any live service.
set -uo pipefail

# SIGPIPE-safe matching: feed grep/awk from a here-string — `grep PAT <<<"$var"`
# — and never pipe a variable's echo output into grep/awk. Under `pipefail`,
# `grep -q` closes the pipe on its FIRST match; on a payload larger than the pipe buffer (e.g. the ~40 KB
# cd.yml read below) the still-writing `echo` takes SIGPIPE, which `pipefail`
# turns into a non-zero pipeline status — silently converting a real match into
# a false "missing" failure. The structural guard at the end of this file keeps
# the antipattern from creeping back in.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../db-migration-guard.sh"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
CD_YML="$REPO_ROOT/.github/workflows/cd.yml"
RUNBOOK="$REPO_ROOT/docs/operations/deploy-migration-rollback.md"
FAILURES=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ -f "$SCRIPT" ] || { echo "gate script not found: $SCRIPT"; exit 1; }

TMPDIR_T="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T"' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# Write stdin to a fixture file under the throwaway dir. Callers then refer to
# it as "$TMPDIR_T/<name>". Deliberately NOT `f="$(fixture x <<EOF ... EOF)"`:
# bash 3.2 (the macOS system bash, and this repo's dev host) cannot parse a
# here-document nested inside a command substitution and dies with
# "unexpected EOF while looking for matching `)'" at PARSE time — i.e. the whole
# suite fails to load, not just that case.
fixture() { cat > "$TMPDIR_T/$1"; }

# Run the gate; echo "<exit>|<output>". $3, if given, is the value of
# ALLOW_DESTRUCTIVE_MIGRATION for that single invocation.
run_gate() {
  local mode="$1" file="$2" out rc
  if [ "$#" -ge 3 ]; then
    out="$(ALLOW_DESTRUCTIVE_MIGRATION="$3" bash "$SCRIPT" "$mode" "$file" 2>&1)"
  else
    out="$(env -u ALLOW_DESTRUCTIVE_MIGRATION bash "$SCRIPT" "$mode" "$file" 2>&1)"
  fi
  rc=$?
  printf '%s|%s' "$rc" "$out"
}

# assert_verdict <label> <mode> <file> <expected-rc> <expected-verdict> [allow]
assert_verdict() {
  local label="$1" mode="$2" file="$3" want_rc="$4" want_verdict="$5" res rc out
  if [ "$#" -ge 6 ]; then res="$(run_gate "$mode" "$file" "$6")"; else res="$(run_gate "$mode" "$file")"; fi
  rc="${res%%|*}"; out="${res#*|}"
  if [ "$rc" = "$want_rc" ]; then
    pass "$label → exit $want_rc"
  else
    fail "$label should exit $want_rc, got $rc"
  fi
  # The verdict line is the machine-readable contract cd.yml keys on. Match it
  # anchored to a whole line so a mention inside prose can never satisfy it.
  if grep -qxF "verdict=$want_verdict" <<<"$out"; then
    pass "$label → verdict=$want_verdict"
  else
    fail "$label should print verdict=$want_verdict; got: $(grep -F 'verdict=' <<<"$out" | tr '\n' ' ')"
  fi
}

echo "=== db-migration-guard.sh: plan classification ==="

# --- 1. No changes: schema already in sync -----------------------------------
fixture nochanges.txt <<'EOF'
Reading config file '/home/runner/work/project-forge/web/drizzle.config.ts'
[i] No changes detected
EOF
f_nochanges="$TMPDIR_T/nochanges.txt"
assert_verdict "no pending statements" plan "$f_nochanges" 0 NO_CHANGES

# --- 2. Clean additive plan ---------------------------------------------------
fixture clean.txt <<'EOF'
Reading config file '/home/runner/work/project-forge/web/drizzle.config.ts'
You are about to execute current statements:

ALTER TABLE "projects" ADD COLUMN "thumbnail_url" text;
CREATE INDEX "projects_owner_idx" ON "projects" ("owner_id");

[i] Changes applied
EOF
f_clean="$TMPDIR_T/clean.txt"
assert_verdict "additive plan" plan "$f_clean" 0 CLEAN
res="$(run_gate plan "$f_clean")"; out="${res#*|}"
if grep -qF 'ALTER TABLE "projects" ADD COLUMN "thumbnail_url" text;' <<<"$out"; then
  pass "clean plan echoes the pending statements into the job summary (AC: emit the diff before applying)"
else
  fail "clean plan does not echo the pending statements — the summary would show a verdict with no diff"
fi
if grep -qF '```sql' <<<"$out"; then
  pass "statements are rendered as a fenced sql block (readable in the step summary)"
else
  fail "statements are not rendered in a fenced sql block"
fi

# --- 3. Statement extraction is SCOPED to the banner block -------------------
# The block ends at the first blank line after the statements (pgPush prints a
# bare console.log() there). Text AFTER that — a stack trace, an unrelated log
# line quoting DDL, a table literally named in prose — must NOT be scanned for
# destructive SQL, or every deploy whose logs happen to contain the words "DROP
# TABLE" would be blocked. This is the false-positive boundary.
fixture scope.txt <<'EOF'
You are about to execute current statements:

ALTER TABLE "projects" ADD COLUMN "thumbnail_url" text;

[i] Changes applied
note: a previous release used DROP TABLE legacy_projects; that is history, not this plan
EOF
f_scope="$TMPDIR_T/scope.txt"
assert_verdict "destructive text OUTSIDE the statement block" plan "$f_scope" 0 CLEAN

# --- 4. Destructive: drizzle-kit's own data-loss classifier ------------------
# This is the highest-value case. In CI the prompt that follows this banner
# THROWS (no TTY), the throw is swallowed, and unguarded drizzle-kit exits 0 —
# so the fixture deliberately also carries the rejection trace. The gate must
# still classify it DESTRUCTIVE, not PLAN_FAILED.
fixture dataloss.txt <<'EOF'
You are about to execute current statements:

ALTER TABLE "projects" DROP COLUMN "legacy_scene";

Found data-loss statements:
· You're about to delete legacy_scene column in projects table with 4210 items
Error: Interactive prompts require a TTY terminal. Please run in an interactive terminal.
    at render (/home/runner/work/node_modules/drizzle-kit/bin.cjs:1449:14)
EOF
f_dataloss="$TMPDIR_T/dataloss.txt"
assert_verdict "drizzle data-loss classifier fires" plan "$f_dataloss" 2 DESTRUCTIVE_BLOCKED
res="$(run_gate plan "$f_dataloss")"; out="${res#*|}"
if grep -qF '::error::Destructive schema migration BLOCKED' <<<"$out"; then
  pass "destructive plan emits a ::error:: workflow annotation"
else
  fail "destructive plan does not emit a ::error:: annotation"
fi
if grep -qF 'production database was not touched' <<<"$out"; then
  pass "destructive plan states plainly that production was not modified"
else
  fail "destructive plan does not state that production was untouched"
fi
if grep -qF 'allow_destructive_migration=true' <<<"$out"; then
  pass "destructive plan names the deliberate-approval route"
else
  fail "destructive plan does not name the approval route (operator has no next step)"
fi

# --- 5. Destructive via the SQL regex, with NO drizzle data-loss marker ------
# Belt and braces: the regex is the fallback for anything drizzle's own
# classifier does not flag (and for a drizzle-kit upgrade that renames the
# marker). Fixture reports "Changes applied" — i.e. it applied fine to the
# THROWAWAY branch — so only the regex can catch it.
fixture droptable.txt <<'EOF'
You are about to execute current statements:

DROP TABLE "abandoned_sessions";

[i] Changes applied
EOF
f_droptable="$TMPDIR_T/droptable.txt"
assert_verdict "DROP TABLE caught by the SQL regex" plan "$f_droptable" 2 DESTRUCTIVE_BLOCKED

# --- 6. Narrowing type change ------------------------------------------------
# AC: "a narrowing type change" must fail the job. drizzle-kit emits every column
# type change as SET DATA TYPE and gives no width information, so the gate cannot
# tell int4→int8 (widening, safe) from int4→int2 (narrowing, lossy). It gates ALL
# of them and lets a human approve the widening ones. Pinning the conservative
# behaviour here so a later "optimisation" cannot quietly let narrowings through.
fixture narrow.txt <<'EOF'
You are about to execute current statements:

ALTER TABLE "cost_log" ALTER COLUMN "tokens" SET DATA TYPE smallint;

[i] Changes applied
EOF
f_narrow="$TMPDIR_T/narrow.txt"
assert_verdict "narrowing type change (SET DATA TYPE)" plan "$f_narrow" 2 DESTRUCTIVE_BLOCKED

# --- 7. Explicit approval downgrades the block -------------------------------
assert_verdict "destructive + explicit approval" plan "$f_dataloss" 0 DESTRUCTIVE_APPROVED true
res="$(run_gate plan "$f_dataloss" true)"; out="${res#*|}"
if grep -qF '::warning::Destructive schema migration EXPLICITLY APPROVED' <<<"$out"; then
  pass "approved destructive plan still emits a ::warning:: (visible, not silent)"
else
  fail "approved destructive plan is silent — an approved DROP should still be loud"
fi
if grep -qF 'docs/operations/deploy-migration-rollback.md' <<<"$out"; then
  pass "approved destructive plan points at the rollback runbook"
else
  fail "approved destructive plan does not point at the runbook"
fi

# --- 8. Approval is EXACT-MATCH on "true" ------------------------------------
# `ALLOW_DESTRUCTIVE_MIGRATION` is fed from a GitHub expression, which yields the
# lowercase strings 'true'/'false'. Anything else is a misconfiguration, and a
# misconfiguration must fail CLOSED. A `[ -n "$VAR" ]` or case-insensitive test
# would turn `false` — the literal value the workflow passes on the default path
# — into an approval. That is the single worst mutation this file can catch.
for bad in false FALSE True TRUE 1 yes on " true" "true "; do
  res="$(run_gate plan "$f_dataloss" "$bad")"
  rc="${res%%|*}"
  if [ "$rc" = "2" ]; then
    pass "ALLOW_DESTRUCTIVE_MIGRATION='$bad' does NOT approve (fails closed, exit 2)"
  else
    fail "ALLOW_DESTRUCTIVE_MIGRATION='$bad' was treated as approval (exit $rc) — must be exactly 'true'"
  fi
done
res="$(run_gate plan "$f_dataloss" "")"
rc="${res%%|*}"
if [ "$rc" = "2" ]; then pass "empty ALLOW_DESTRUCTIVE_MIGRATION does not approve"; else fail "empty ALLOW_DESTRUCTIVE_MIGRATION approved (exit $rc)"; fi

echo ""
echo "=== db-migration-guard.sh: failure classification (fail-closed) ==="

# --- 9. Declined / aborted run -----------------------------------------------
fixture aborted.txt <<'EOF'
You are about to execute current statements:

ALTER TABLE "projects" ADD COLUMN "x" text;

[i] All changes were aborted
EOF
f_aborted="$TMPDIR_T/aborted.txt"
assert_verdict "aborted dry run" plan "$f_aborted" 3 PLAN_FAILED

# --- 10. Unrecognisable output (drizzle crashed before printing anything) ----
# The most dangerous silent failure: pgPush swallows the exception and exits 0,
# so without this branch a crashed dry run reads as "nothing to do" and the
# production apply runs completely unrehearsed.
fixture garbage.txt <<'EOF'
Reading config file '/home/runner/work/project-forge/web/drizzle.config.ts'
Error: getaddrinfo ENOTFOUND ep-throwaway-branch.us-east-2.aws.neon.tech
EOF
f_garbage="$TMPDIR_T/garbage.txt"
assert_verdict "connection failure with no plan and no 'no changes'" plan "$f_garbage" 3 PLAN_FAILED

# --- 11. Empty capture --------------------------------------------------------
: > "$TMPDIR_T/empty.txt"
f_empty="$TMPDIR_T/empty.txt"
assert_verdict "empty capture" plan "$f_empty" 3 PLAN_FAILED

# --- 12. Banner present but the dry run never applied ------------------------
# The plan parsed, but it failed against the throwaway branch. Because the pg
# push loop is untransacted, the same statements against production would leave
# it half-migrated — so this must block, not warn.
fixture notapplied.txt <<'EOF'
You are about to execute current statements:

ALTER TABLE "projects" ADD COLUMN "x" text;

error: column "x" of relation "projects" already exists
EOF
f_notapplied="$TMPDIR_T/notapplied.txt"
assert_verdict "dry run failed to apply to the throwaway branch" plan "$f_notapplied" 3 PLAN_FAILED
res="$(run_gate plan "$f_notapplied")"; out="${res#*|}"
if grep -qF 'without a transaction' <<<"$out"; then
  pass "failed-dry-run message explains the untransacted-apply risk"
else
  fail "failed-dry-run message does not explain why a partial apply is the hazard"
fi

# --- 13. Banner present but no statements could be parsed --------------------
fixture nostmts.txt <<'EOF'
You are about to execute current statements:

[i] Changes applied
EOF
f_nostmts="$TMPDIR_T/nostmts.txt"
assert_verdict "banner with an unparseable statement block" plan "$f_nostmts" 3 PLAN_FAILED

# --- 14. Missing capture file → fail CLOSED ----------------------------------
# A missing file means the push step produced no output at all. Treating that as
# "no changes" would let the production apply run with zero rehearsal.
assert_verdict "capture file does not exist" plan "$TMPDIR_T/does-not-exist.txt" 3 PLAN_FAILED

# --- 15. Unreadable capture file → fail CLOSED -------------------------------
f_unreadable="$TMPDIR_T/unreadable.txt"
printf '[i] No changes detected\n' > "$f_unreadable"
chmod 000 "$f_unreadable"
if [ -r "$f_unreadable" ]; then
  # Running as root (or an OS ignoring the mode) — the case is unobservable, so
  # say so rather than asserting something the environment cannot demonstrate.
  echo "  SKIP: unreadable-file case (this user can read mode-000 files)"
else
  assert_verdict "capture file is unreadable" plan "$f_unreadable" 3 PLAN_FAILED
fi
chmod 644 "$f_unreadable"

echo ""
echo "=== db-migration-guard.sh: ANSI-wrapped output ==="
# drizzle-kit force-enables colour when GITHUB_ACTIONS is in the environment
# (bin.cjs ~L14886 keys on CI + GITHUB_ACTIONS), so in the real job the markers
# can arrive wrapped in escape sequences. A gate that matched raw bytes would
# classify a coloured destructive plan as "unrecognised" — and PLAN_FAILED is a
# safe verdict, but a coloured CLEAN plan would ALSO fail, breaking every
# deploy. Both directions are pinned.
printf 'You are about to execute current statements:\n\n\033[31mALTER TABLE "projects" DROP COLUMN "legacy";\033[0m\n\n\033[32m[i] Changes applied\033[0m\n' > "$TMPDIR_T/ansi-destructive.txt"
assert_verdict "ANSI-coloured destructive plan" plan "$TMPDIR_T/ansi-destructive.txt" 2 DESTRUCTIVE_BLOCKED
printf '\033[2mReading config file\033[0m\n\033[36m[i] No changes detected\033[0m\n' > "$TMPDIR_T/ansi-nochanges.txt"
assert_verdict "ANSI-coloured no-changes result" plan "$TMPDIR_T/ansi-nochanges.txt" 0 NO_CHANGES

echo ""
echo "=== db-migration-guard.sh: verify (post-apply convergence) ==="
# This mode is the ONLY signal that the production apply actually finished.
# drizzle-kit exits 0 on a half-applied migration, so cd.yml re-runs push after
# the apply: a second run that reports "No changes detected" and NO statement
# banner proves convergence.
assert_verdict "second push reports no changes" verify "$f_nochanges" 0 CONVERGED
assert_verdict "second push still has pending statements" verify "$f_clean" 4 NOT_CONVERGED
res="$(run_gate verify "$f_clean")"; out="${res#*|}"
if grep -qF 'partially migrated' <<<"$out"; then
  pass "NOT_CONVERGED warns that the database may be partially migrated"
else
  fail "NOT_CONVERGED does not warn about a partial migration"
fi
if grep -qF 'docs/operations/deploy-migration-rollback.md' <<<"$out"; then
  pass "NOT_CONVERGED points at the rollback runbook"
else
  fail "NOT_CONVERGED does not point at the runbook"
fi
# A capture carrying BOTH markers must not be read as converged: the banner wins.
fixture both.txt <<'EOF'
[i] No changes detected
You are about to execute current statements:

ALTER TABLE "projects" ADD COLUMN "y" text;

[i] Changes applied
EOF
f_both="$TMPDIR_T/both.txt"
assert_verdict "verify with both markers present" verify "$f_both" 4 NOT_CONVERGED
assert_verdict "verify on an unrecognisable capture" verify "$f_garbage" 4 NOT_CONVERGED
assert_verdict "verify on a missing capture" verify "$TMPDIR_T/does-not-exist.txt" 3 PLAN_FAILED

echo ""
echo "=== db-migration-guard.sh: usage contract ==="
for bad_argv in "" "bogus" "plan"; do
  # shellcheck disable=SC2086
  # Deliberate word-splitting: $bad_argv models an argv list, not a filename.
  out="$(bash "$SCRIPT" $bad_argv 2>&1)"; rc=$?
  if [ "$rc" = "64" ]; then
    pass "argv '${bad_argv:-<none>}' is a usage error (exit 64)"
  else
    fail "argv '${bad_argv:-<none>}' should exit 64, got $rc"
  fi
  if grep -qF 'usage:' <<<"$out"; then
    pass "argv '${bad_argv:-<none>}' prints usage"
  else
    fail "argv '${bad_argv:-<none>}' prints no usage line"
  fi
done

echo ""
echo "=== the gate touches nothing (structural) ==="
# The hard constraint on #9456 is that this logic must never reach a live
# service. The gate is a pure text classifier; these assertions make that a
# testable property rather than a claim in a comment. Mutation-provable: add a
# curl/psql call to the gate and the matching case fails.
# Comment-strip first: the header legitimately DISCUSSES drizzle-kit and node,
# and a doc mention is not an invocation. Only executable lines are scanned.
guard_exec="$(grep -v '^[[:space:]]*#' "$SCRIPT" || true)"
for forbidden in curl wget psql pg_dump nc ssh node; do
  if grep -qE "(^|[^[:alnum:]_./-])${forbidden}([^[:alnum:]_-]|$)" <<<"$guard_exec"; then
    fail "gate has an executable line mentioning '$forbidden' — it must perform no network/DB/tool I/O"
  else
    pass "gate does not invoke '$forbidden'"
  fi
done

echo ""
echo "=== cd.yml integration wiring ==="
# A gate nobody calls is decoration. These pin that deploy-production actually
# routes the production schema change through it, in the right ORDER, and that
# the pieces the acceptance criteria name are present.
if [ -f "$CD_YML" ]; then
  cd_yml="$(cat "$CD_YML")"
  cd_exec="$(grep -v '^[[:space:]]*#' <<<"$cd_yml" || true)"

  if grep -qF 'scripts/db-migration-guard.sh plan' <<<"$cd_exec"; then
    pass "cd.yml classifies the dry run with the guard's plan mode"
  else
    fail "cd.yml does not run db-migration-guard.sh plan — the destructive-diff gate is not wired"
  fi

  if grep -qF 'scripts/db-migration-guard.sh verify' <<<"$cd_exec"; then
    pass "cd.yml verifies convergence after the production apply"
  else
    fail "cd.yml does not run db-migration-guard.sh verify — a half-applied migration would ship green"
  fi

  if grep -qF 'scripts/neon-branch.sh create' <<<"$cd_exec"; then
    pass "cd.yml creates a Neon snapshot branch"
  else
    fail "cd.yml does not create a Neon snapshot branch before mutating production"
  fi

  # ORDER is the whole point of the snapshot: it must exist BEFORE the first
  # statement runs against production. Compare line numbers of the snapshot
  # creation against every production-mutating step. `grep -n` on the file (not
  # the comment-stripped copy) keeps the numbers meaningful.
  snap_line="$(grep -nF 'db-snapshot' "$CD_YML" | head -1 | cut -d: -f1)"
  pgvector_line="$(grep -nF 'Enable pgvector extension' "$CD_YML" | head -1 | cut -d: -f1)"
  apply_line="$(grep -nF 'Apply schema migration to production' "$CD_YML" | head -1 | cut -d: -f1)"
  if [ -n "$snap_line" ] && [ -n "$pgvector_line" ] && [ "$snap_line" -lt "$pgvector_line" ]; then
    pass "snapshot branch is created BEFORE the pgvector step (the first production mutation)"
  else
    fail "snapshot branch is not created before the pgvector step (snap=$snap_line pgvector=$pgvector_line)"
  fi
  if [ -n "$snap_line" ] && [ -n "$apply_line" ] && [ "$snap_line" -lt "$apply_line" ]; then
    pass "snapshot branch is created BEFORE the production schema apply"
  else
    fail "snapshot branch is not created before the production apply (snap=$snap_line apply=$apply_line)"
  fi

  # The snapshot id has to reach the log, or the operator cannot restore from it.
  if grep -qF 'snapshot_branch_id' <<<"$cd_exec"; then
    pass "cd.yml carries the snapshot branch id forward as a step output"
  else
    fail "cd.yml does not expose the snapshot branch id — the rollback path has nothing to name"
  fi

  # The plan must reach the job summary, not just the raw log.
  if grep -qF 'GITHUB_STEP_SUMMARY' <<<"$cd_exec"; then
    pass "cd.yml writes to the job summary"
  else
    fail "cd.yml never writes a job summary — the pending diff would only exist in raw logs"
  fi

  # --force on the PRODUCTION apply is deliberate and load-bearing: without it,
  # a data-loss diff hits the TTY-gated prompt, which throws, which pgPush
  # swallows — silently SKIPPING the migration while the deploy proceeds. The
  # destructive gate runs BEFORE this point, so --force here is not a bypass;
  # removing it would reintroduce the silent-skip bug.
  if grep -qE 'drizzle-kit push[^|]*--force' <<<"$cd_exec"; then
    pass "the production apply passes --force (no TTY prompt to silently swallow)"
  else
    fail "the production apply omits --force — a data-loss diff would be silently skipped in CI"
  fi

  # The rollback step must be honest that `vercel promote` reverts CODE ONLY.
  if grep -qF 'does NOT revert the database schema' <<<"$cd_yml"; then
    pass "the rollback step states plainly that the schema is not reverted"
  else
    fail "the rollback step implies a clean rollback — it must say the schema was NOT reverted"
  fi
  if grep -qF 'docs/operations/deploy-migration-rollback.md' <<<"$cd_yml"; then
    pass "cd.yml points the operator at the restore runbook"
  else
    fail "cd.yml does not reference the restore runbook"
  fi
else
  fail "cd.yml not found at $CD_YML"
fi

echo ""
echo "=== runbook (AC: docs/operations entry with the exact restore command) ==="
if [ -f "$RUNBOOK" ]; then
  pass "docs/operations/deploy-migration-rollback.md exists"
  rb="$(cat "$RUNBOOK")"
  # The AC asks for the EXACT restore command. Pin the pieces that make it
  # exact — the endpoint and the field that names what to restore from — so a
  # later doc edit cannot soften it into "restore the branch in the console".
  if grep -qF '/restore' <<<"$rb"; then
    pass "runbook names the Neon branch restore endpoint"
  else
    fail "runbook does not name the restore endpoint"
  fi
  if grep -qF 'source_branch_id' <<<"$rb"; then
    pass "runbook gives the source_branch_id field (restore FROM the snapshot)"
  else
    fail "runbook omits source_branch_id — the command is not runnable as written"
  fi
  if grep -qiF 'deploy failed after the migration' <<<"$rb"; then
    pass "runbook covers the 'deploy failed after the migration step' scenario by name"
  else
    fail "runbook does not cover the named scenario 'deploy failed after the migration step'"
  fi
else
  fail "runbook not found at $RUNBOOK"
fi

echo ""
echo "=== ci.yml self-defense wiring ==="
if [ -f "$CI_YML" ]; then
  ci="$(cat "$CI_YML")"
  if grep -qF 'bash scripts/__tests__/db-migration-guard.test.sh' <<<"$ci"; then
    pass "CI runs this suite"
  else
    fail "CI does not run scripts/__tests__/db-migration-guard.test.sh — regressions would ship green"
  fi
  if grep -qF 'scripts/db-migration-guard.sh' <<<"$ci" && grep -qF 'scripts/neon-branch.sh' <<<"$ci"; then
    pass "CI shellchecks both new scripts"
  else
    fail "CI does not shellcheck the new migration-guard / neon-branch scripts"
  fi
else
  fail "ci.yml not found at $CI_YML"
fi

echo ""
echo "=== suite hygiene (structural) ==="
# Regression lock for the SIGPIPE-under-pipefail false failure documented at the
# top of this file. The needle glues `echo` to `[[:space:]]` so this guard line
# can never match itself; the alternation covers both `$VAR` and `${VAR}`.
SELF="${BASH_SOURCE[0]}"
if grep -nE 'echo[[:space:]]+"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?"[[:space:]]*\|[[:space:]]*(grep|awk)' "$SELF" >/dev/null; then
  fail "a variable's echo output is piped into grep/awk — feed it via a here-string to stay correct under pipefail"
else
  pass "suite feeds grep/awk via here-strings, not variable pipes (SIGPIPE-safe under pipefail)"
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
