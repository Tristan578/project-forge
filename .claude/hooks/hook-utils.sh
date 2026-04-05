#!/usr/bin/env bash
# Shared utilities for Claude Code hooks.
#
# TWO INPUT PATTERNS (not interchangeable):
#
#   1. Edit/Write hooks: TOOL_INPUT_<field> env vars (e.g. TOOL_INPUT_file_path)
#      Use directly: FILE_PATH="${TOOL_INPUT_file_path:-}"
#
#   2. Bash hooks: stdin JSON parsed with jq
#      Use: source hook-utils.sh; COMMAND=$(get_bash_command)
#
# This file provides helpers for pattern #2 (Bash hooks).
# Pattern #1 doesn't need a helper — env vars are already simple.

# Read stdin JSON once (must be called before any stdin reads).
# Stores result in _HOOK_INPUT for reuse.
_HOOK_INPUT=""
hook_read_input() {
  if [ -z "$_HOOK_INPUT" ]; then
    _HOOK_INPUT=$(cat)
  fi
  echo "$_HOOK_INPUT"
}

# Extract .tool_input.command from stdin JSON (Bash hooks).
# Falls back to TOOL_INPUT_command env var if jq parsing fails.
# Returns empty string if neither source has data.
get_bash_command() {
  local input
  input=$(hook_read_input)
  local cmd
  cmd=$(echo "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
  if [ -z "$cmd" ]; then
    cmd="${TOOL_INPUT_command:-}"
  fi
  echo "$cmd"
}

# Extract an arbitrary field from .tool_input (Bash hooks).
# Usage: get_tool_field "command"  or  get_tool_field "file_path"
get_tool_field() {
  local field="$1"
  local input
  input=$(hook_read_input)
  local val
  val=$(echo "$input" | jq -r ".tool_input.${field} // empty" 2>/dev/null)
  if [ -z "$val" ]; then
    # Fallback to env var convention (indirect expansion, no eval)
    local env_var="TOOL_INPUT_${field}"
    val="${!env_var:-}"
  fi
  echo "$val"
}
