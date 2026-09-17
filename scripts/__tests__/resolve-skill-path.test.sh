#!/usr/bin/env bash
# Exercise the shipped skill resolver with provider-only, malformed, and missing fixtures.
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
source "$repo_root/.claude/tools/resolve-skill-path.sh"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
project_directory="$fixture/project with spaces"
user_directory="$fixture/user with spaces"
mkdir -p "$project_directory" "$user_directory"
checks=0
for scope in project user; do
  if [ "$scope" = project ]; then root_directory="$project_directory"; else root_directory="$user_directory"; fi
  for provider in .claude .agents .agent .codex; do
    skill_file="$root_directory/$provider/skills/frontend/SKILL.md"
    mkdir -p "$(dirname "$skill_file")"
    printf '# Fixture skill\n' > "$skill_file"
    actual="$(resolve_skill_path frontend "$project_directory" "$user_directory")"
    [ "$actual" = "$skill_file" ] || { echo 'Provider-only resolver mismatch' >&2; exit 1; }
    rm "$skill_file"
    if resolve_skill_path frontend "$project_directory" "$user_directory" >/dev/null; then
      echo 'A directory without SKILL.md resolved' >&2; exit 1
    fi
    checks=$((checks + 2))
  done
 done
# Project authority precedes user authority; malformed earlier project roots
# do not shadow a valid supported provider file.
mkdir -p "$project_directory/.agents/skills/frontend" "$user_directory/.claude/skills/frontend"
printf '# Project fixture\n' > "$project_directory/.agents/skills/frontend/SKILL.md"
printf '# User fixture\n' > "$user_directory/.claude/skills/frontend/SKILL.md"
[ "$(resolve_skill_path frontend "$project_directory" "$user_directory")" = "$project_directory/.agents/skills/frontend/SKILL.md" ]
checks=$((checks + 1))
for invalid in missing '' ../frontend 'nested/frontend' 'nested\frontend'; do
  if resolve_skill_path "$invalid" "$project_directory" "$user_directory" >/dev/null; then
    echo 'Absent or invalid skill resolved' >&2; exit 1
  fi
  checks=$((checks + 1))
done
printf 'PASS: %s provider skill resolution checks\n' "$checks"
