#!/usr/bin/env bash
# Tests for the committed permission posture in .claude/settings.json:
#   * a `permissions.allow` allow-list of safe read/build/test commands,
#   * a `permissions.deny` guard protecting the two off-limits config files
#     (.claude/settings.json and .codex/config.toml) for BOTH Edit and Write,
#   * the auto-approve-safe-commands.sh hook wired as a PreToolUse Bash hook.
#
# Deny paths use the gitignore-anchored, project-root form `/<path>` so they
# match regardless of the agent's current working directory. Edit and Write are
# distinct permission tools, so each off-limits file is denied for both.
#
# Run: bash .claude/hooks/__tests__/settings-permissions.test.sh
set -uo pipefail

command -v jq >/dev/null 2>&1 || { echo "jq is required to run these tests"; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS="$HERE/../../settings.json"

pass=0
fail=0

# assert_jq <desc> <jq-arg>... <filter> — pass when the jq query succeeds (exit
# 0, truthy) against settings.json. Everything after <desc> is forwarded to jq
# verbatim, so callers may pass `--arg name value` ahead of the filter.
assert_jq() {
  local desc="$1"; shift
  if jq -e "$@" "$SETTINGS" >/dev/null 2>&1; then
    pass=$((pass + 1))
    printf '  ok   %s\n' "$desc"
  else
    fail=$((fail + 1))
    printf '  FAIL %s\n' "$desc"
  fi
}

echo "settings.json permissions"

# --- Valid JSON & block shape ---
assert_jq "settings.json is valid JSON"        '.'
assert_jq "permissions is an object"           '.permissions | type == "object"'
assert_jq "permissions.allow is a non-empty array" '(.permissions.allow | type == "array") and (.permissions.allow | length > 0)'
assert_jq "permissions.deny is a non-empty array"  '(.permissions.deny | type == "array") and (.permissions.deny | length > 0)'

# --- Representative allow rules (safe read/build/test commands) ---
for rule in \
  'Bash(npm ci:*)' \
  'Bash(npm install:*)' \
  'Bash(npm run:*)' \
  'Bash(npm test:*)' \
  'Bash(npx vitest:*)' \
  'Bash(npx eslint:*)' \
  'Bash(npx tsc:*)' \
  'Bash(git status:*)' \
  'Bash(git diff:*)' \
  'Bash(git log:*)' \
  'Bash(cargo check:*)' ; do
  # shellcheck disable=SC2016  # $r is a jq variable bound via --arg, not a shell var
  assert_jq "allow contains $rule" --arg r "$rule" '.permissions.allow | index($r) != null'
done

# --- Off-limits file guards: project-root-anchored, Edit AND Write ---
for rule in \
  'Edit(/.claude/settings.json)' \
  'Write(/.claude/settings.json)' \
  'Edit(/.codex/config.toml)' \
  'Write(/.codex/config.toml)' ; do
  # shellcheck disable=SC2016  # $r is a jq variable bound via --arg, not a shell var
  assert_jq "deny contains $rule" --arg r "$rule" '.permissions.deny | index($r) != null'
done

# --- Negative guards: dangerous / side-effecting rules must NOT be auto-allowed.
#     `npm exec` runs arbitrary package binaries; the rest mutate state. ---
for rule in \
  'Bash(npm exec:*)' \
  'Bash(npm publish:*)' \
  'Bash(git push:*)' \
  'Bash(rm:*)' \
  'Bash(rm -rf:*)' ; do
  # shellcheck disable=SC2016  # $r is a jq variable bound via --arg, not a shell var
  assert_jq "allow does NOT contain $rule" --arg r "$rule" '.permissions.allow | index($r) == null'
done

# --- The auto-approve hook is wired as a PreToolUse hook matching Bash ---
# shellcheck disable=SC2016  # jq filter; no shell expansion intended
assert_jq "auto-approve hook wired under PreToolUse with a Bash matcher" '
  [ .hooks.PreToolUse[]
    | select(any(.hooks[]?; .command | test("auto-approve-safe-commands\\.sh")))
    | .matcher // "" ]
  | any(test("Bash"))
'

echo ""
echo "passed: $pass  failed: $fail"
[ "$fail" -eq 0 ]
