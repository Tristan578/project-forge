#!/usr/bin/env bash
# Resolve agent skill references across supported project and user provider roots.
# Source this module and call resolve_skill_path <skill> <project-root> [user-root].
# Project roots take precedence; a directory without SKILL.md never resolves.
resolve_skill_path() {
  local skill_name="${1:-}" project_directory="${2:-}" user_directory="${3:-$HOME}"
  case "$skill_name" in ''|.|..|*/*|*\\*) return 1 ;; esac
  [ -n "$project_directory" ] || return 1
  local provider_root
  for provider_root in .claude .agents .agent .codex; do
    if [ -f "$project_directory/$provider_root/skills/$skill_name/SKILL.md" ]; then
      printf '%s\n' "$project_directory/$provider_root/skills/$skill_name/SKILL.md"
      return 0
    fi
  done
  for provider_root in .claude .agents .agent .codex; do
    if [ -f "$user_directory/$provider_root/skills/$skill_name/SKILL.md" ]; then
      printf '%s\n' "$user_directory/$provider_root/skills/$skill_name/SKILL.md"
      return 0
    fi
  done
  return 1
}
