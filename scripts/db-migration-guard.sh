#!/usr/bin/env bash
# Production schema-migration guard — classifies a captured `drizzle-kit push`
# run and decides whether the same migration may be applied to the production
# database.
#
# WHY THIS EXISTS (#9456)
# ----------------------
# `.github/workflows/cd.yml` mutates the production database with
# `drizzle-kit push` BEFORE the new code deploys. Three properties of
# drizzle-kit 0.31.10's `pgPush` (verified by reading
# node_modules/drizzle-kit/bin.cjs, `pgPush = async (...)` at ~L82701) make that
# unsafe to run unsupervised:
#
#   1. The whole body is wrapped in `try { ... } catch (e) { console.error(e) }`
#      with NO `process.exit(1)`. Every failure — a SQL error mid-apply, a
#      rejected prompt — is printed and the process still exits 0. CI reads that
#      as success and deploys.
#   2. Statements are applied in a bare `for (const dStmnt of statementsToExecute)
#      { await db.query(dStmnt) }` loop with NO transaction (the sqlite path does
#      `begin`/`commit`; the pg path does not). A failure half-way leaves a
#      partially migrated schema.
#   3. On a data-loss diff and without `--force`, it calls
#      `render(new Select([...]))`. hanji's `render` rejects when
#      `!process.stdin.isTTY || !process.stdout.isTTY` (bin.cjs ~L1449) — i.e.
#      always in CI — so the rejection lands in (1) and the migration is SILENTLY
#      SKIPPED while the deploy proceeds against the old schema.
#
# So drizzle-kit's own exit code carries no information. This script recovers the
# outcome from the one thing that IS reliable: what `pgPush` printed. Every
# marker matched below is a literal from bin.cjs:
#
#   "You are about to execute current statements:"  (printed under --verbose,
#                                                    BEFORE any prompt or apply)
#   "Found data-loss statements:"                   (drizzle's own destructive
#                                                    classifier, printed when
#                                                    !force && shouldAskForApprove)
#   "Changes applied"                               (render() after the apply loop)
#   "No changes detected"                           (render() when the diff is empty)
#   "All changes were aborted"                      (render() after a declined prompt)
#
# `render(<string>)` has no TTY guard (bin.cjs ~L1443: plain strings go straight
# to `process.stdout.write`), so those last three DO appear in CI logs. Only the
# interactive `Select` view is TTY-gated.
#
# SUBCOMMANDS
#   plan <file>    Classify a dry-run push captured against a THROWAWAY Neon
#                  branch. Decides whether production may be touched.
#   verify <file>  Classify a post-apply re-push captured against PRODUCTION.
#                  Proves the apply actually converged (closes hazards 1 and 2).
#
# ENVIRONMENT
#   ALLOW_DESTRUCTIVE_MIGRATION  Exactly the string "true" downgrades a
#                                destructive verdict from blocking to approved.
#                                Anything else (unset, "", "TRUE", "1") blocks.
#
# EXIT CODES
#   0   safe to proceed  (NO_CHANGES | CLEAN | DESTRUCTIVE_APPROVED | CONVERGED)
#   2   DESTRUCTIVE_BLOCKED — the diff drops/rewrites data and was not approved
#   3   PLAN_FAILED        — the run errored, aborted, or produced no usable plan
#   4   NOT_CONVERGED      — production still has pending statements after apply
#   64  usage error
#
# Exit codes are the contract; unit tests in
# scripts/__tests__/db-migration-guard.test.sh pin every branch.
#
# This script performs NO network and NO database I/O. It reads one text file.
set -uo pipefail

USAGE="usage: db-migration-guard.sh {plan|verify} <captured-output-file>"

# Literal markers emitted by drizzle-kit 0.31.10's pgPush (see header).
MARK_BANNER='You are about to execute current statements:'
MARK_DATALOSS='Found data-loss statements:'
MARK_APPLIED='Changes applied'
MARK_NOCHANGES='No changes detected'
MARK_ABORTED='All changes were aborted'

# Destructive SQL the gate refuses to apply to production unattended.
# Matched case-insensitively against the extracted statement block only.
#   DROP TABLE / DROP COLUMN            — the two the ticket names outright
#   SET DATA TYPE                       — how drizzle-kit emits a column type
#                                         change; any such change may narrow or
#                                         fail to cast, so all of them are gated
#   DROP SCHEMA / DROP TYPE             — take every dependent object with them
#   DROP MATERIALIZED VIEW / DROP VIEW  — drop derived objects code may depend on
#   TRUNCATE                            — drizzle emits this for some rewrites
DESTRUCTIVE_RE='DROP[[:space:]]+TABLE|DROP[[:space:]]+COLUMN|DROP[[:space:]]+SCHEMA|DROP[[:space:]]+TYPE|DROP[[:space:]]+MATERIALIZED[[:space:]]+VIEW|DROP[[:space:]]+VIEW|SET[[:space:]]+DATA[[:space:]]+TYPE|TRUNCATE'

# Non-blocking hazards worth surfacing in the job summary. SET NOT NULL does not
# destroy data, but it aborts the (untransacted) apply loop when the column holds
# an existing NULL — which, per hazard 2 above, leaves the schema half-migrated.
RISKY_RE='SET[[:space:]]+NOT[[:space:]]+NULL|ADD[[:space:]]+CONSTRAINT|CREATE[[:space:]]+UNIQUE'

MODE="${1:-}"
FILE="${2:-}"

if [ "$MODE" != "plan" ] && [ "$MODE" != "verify" ]; then
  echo "::error::$USAGE" >&2
  exit 64
fi
if [ -z "$FILE" ]; then
  echo "::error::$USAGE" >&2
  exit 64
fi

# Fail CLOSED on an unreadable capture. A missing file means the push step did
# not even produce output — never treat that as "nothing to do".
if [ ! -r "$FILE" ]; then
  echo "::error::db-migration-guard: cannot read captured output '$FILE' — treating as a failed run."
  echo "verdict=PLAN_FAILED"
  exit 3
fi

# drizzle-kit force-enables colour when GITHUB_ACTIONS is in the environment, so
# the markers can arrive wrapped in ANSI escapes. Strip them before matching.
# (cd.yml also sets NO_COLOR/FORCE_COLOR=0; this is the belt to that braces.)
OUT="$(sed $'s/\033\\[[0-9;]*[A-Za-z]//g' "$FILE")"

has() { grep -qF -- "$1" <<<"$OUT"; }

# Extract the statement block printed under --verbose: everything after the
# banner line, minus leading blank lines, up to the first blank line that closes
# the block (pgPush prints `console.log()` immediately after the statements).
# The block ALSO terminates on drizzle's own status markers (`[i] …`, the
# data-loss banner) and on a node error line: when a plan is empty or the run
# throws, the next non-blank line after the banner is one of those, and slurping
# it as if it were SQL would turn an unparseable run into a "CLEAN" verdict.
extract_statements() {
  awk -v banner="$MARK_BANNER" '
    index($0, banner) { found = 1; next }
    !found { next }
    !started && $0 ~ /^[[:space:]]*$/ { next }
    $0 ~ /^[[:space:]]*$/ { exit }
    $0 ~ /^[[:space:]]*(\[i\]|Found data-loss|Error:|[A-Za-z]*Error:)/ { exit }
    { started = 1; print }
  ' <<<"$OUT"
}

# Heading for the markdown block emit() writes; `verify` retitles it.
EMIT_TITLE='Database migration plan'

emit() {
  # $1 verdict, $2 headline, rest: detail lines
  local verdict="$1" headline="$2"
  shift 2
  echo "### $EMIT_TITLE"
  echo
  echo "**Verdict:** \`$verdict\` — $headline"
  echo
  # Callers pass optional detail lines as "${var:+...}" expansions, which
  # collapse to empty strings when the variable is unset. Drop those.
  for line in "$@"; do [ -n "$line" ] && echo "$line"; done
  if [ -n "$STATEMENTS" ]; then
    echo
    echo "<details><summary>Statements drizzle-kit would execute</summary>"
    echo
    echo '```sql'
    echo "$STATEMENTS"
    echo '```'
    echo
    echo "</details>"
  fi
  echo
  echo "verdict=$verdict"
}

STATEMENTS="$(extract_statements)"

# ---------------------------------------------------------------------------
# verify — did the production apply actually converge?
# ---------------------------------------------------------------------------
if [ "$MODE" = "verify" ]; then
  STATEMENTS=""   # the verification run should have nothing to show
  if has "$MARK_NOCHANGES" && ! has "$MARK_BANNER"; then
    echo "### Post-migration verification"
    echo
    echo "**Verdict:** \`CONVERGED\` — a follow-up \`drizzle-kit push\` reports no pending statements."
    echo
    echo "verdict=CONVERGED"
    exit 0
  fi
  STATEMENTS="$(extract_statements)"
  EMIT_TITLE='Post-migration verification'
  echo "::error::Production schema did NOT converge after the migration step."
  echo "::error::drizzle-kit still reports pending statements, which means the apply loop failed part-way."
  echo "::error::drizzle-kit exits 0 on a failed apply (see scripts/db-migration-guard.sh header), so this check is the only signal."
  echo "::error::Runbook: docs/operations/deploy-migration-rollback.md"
  emit "NOT_CONVERGED" "production still has pending schema statements after the apply step" \
    "The database may be **partially migrated**. Do not retry blindly — read the runbook."
  exit 4
fi

# ---------------------------------------------------------------------------
# plan — may we touch production at all?
# ---------------------------------------------------------------------------

# Destructive first: on a data-loss diff drizzle prints its banner and THEN
# throws on the TTY-gated prompt, so the capture also contains an error trace.
# Classifying on the error first would mislabel every destructive plan.
destructive_reason=""
if has "$MARK_DATALOSS"; then
  destructive_reason="drizzle-kit's own classifier reported \`$MARK_DATALOSS\`"
elif [ -n "$STATEMENTS" ] && grep -qEi -- "$DESTRUCTIVE_RE" <<<"$STATEMENTS"; then
  destructive_reason="the plan contains destructive SQL"
fi

if [ -n "$destructive_reason" ]; then
  matched="$(grep -Ei -- "$DESTRUCTIVE_RE" <<<"$STATEMENTS" || true)"
  if [ "${ALLOW_DESTRUCTIVE_MIGRATION:-}" = "true" ]; then
    echo "::warning::Destructive schema migration EXPLICITLY APPROVED for production."
    emit "DESTRUCTIVE_APPROVED" "destructive diff approved via ALLOW_DESTRUCTIVE_MIGRATION" \
      "$destructive_reason." \
      "Approval was granted explicitly, so the apply will proceed." \
      "The pre-migration Neon snapshot branch is the ONLY way back — see docs/operations/deploy-migration-rollback.md." \
      "${matched:+Destructive statements:}" "${matched:+\`\`\`sql}" "${matched:+$matched}" "${matched:+\`\`\`}"
    exit 0
  fi
  echo "::error::Destructive schema migration BLOCKED — production database was not touched."
  echo "::error::$destructive_reason."
  echo "::error::To proceed deliberately: re-run this workflow via workflow_dispatch with allow_destructive_migration=true,"
  echo "::error::or push a commit whose message contains [allow-destructive-migration]."
  emit "DESTRUCTIVE_BLOCKED" "destructive diff requires explicit approval" \
    "$destructive_reason." \
    "**Production was not modified.**" \
    "Approve deliberately with \`workflow_dispatch\` input \`allow_destructive_migration=true\`, or a commit message containing \`[allow-destructive-migration]\`." \
    "${matched:+Destructive statements:}" "${matched:+\`\`\`sql}" "${matched:+$matched}" "${matched:+\`\`\`}"
  exit 2
fi

if has "$MARK_ABORTED"; then
  echo "::error::drizzle-kit reported '$MARK_ABORTED' — the dry run did not complete."
  emit "PLAN_FAILED" "the dry run was aborted" "Production was not modified."
  exit 3
fi

if ! has "$MARK_BANNER"; then
  if has "$MARK_NOCHANGES"; then
    emit "NO_CHANGES" "schema is already in sync — nothing to apply" \
      "The dry run against the throwaway Neon branch found no pending statements."
    exit 0
  fi
  echo "::error::drizzle-kit produced neither a statement plan nor a 'no changes' result."
  echo "::error::Treating an unrecognised dry run as a failure — production was not modified."
  emit "PLAN_FAILED" "dry run produced no recognisable result" \
    "Neither \`$MARK_BANNER\` nor \`$MARK_NOCHANGES\` appeared in the captured output."
  exit 3
fi

# Banner present, so there IS a plan. It must also have applied cleanly to the
# throwaway branch; if it did not, the same statements will not apply cleanly to
# production either.
if [ -z "$STATEMENTS" ]; then
  echo "::error::drizzle-kit printed the statement banner but no statements could be extracted."
  emit "PLAN_FAILED" "statement plan could not be parsed" \
    "Read the raw step log before retrying — production was not modified."
  exit 3
fi

if ! has "$MARK_APPLIED"; then
  echo "::error::The dry run failed to apply cleanly to the throwaway Neon branch."
  echo "::error::drizzle-kit exits 0 on a failed apply, so this check is the only signal."
  emit "PLAN_FAILED" "dry run failed against the throwaway branch" \
    "The same statements would fail part-way against production, which applies them **without a transaction**." \
    "Production was not modified."
  exit 3
fi

risky="$(grep -Ei -- "$RISKY_RE" <<<"$STATEMENTS" || true)"
if [ -n "$risky" ]; then
  echo "::warning::Migration plan contains statements that can abort part-way on live data."
fi
emit "CLEAN" "non-destructive plan, applied cleanly to a throwaway copy of production" \
  "${risky:+> **Heads up:** these statements can abort mid-apply on live data (the pg push loop is untransacted):}" \
  "${risky:+\`\`\`sql}" "${risky:+$risky}" "${risky:+\`\`\`}"
exit 0
