#!/usr/bin/env bash
# Exercise the shipped skill resolver with provider-only, malformed, and missing fixtures.
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
source "$repo_root/.claude/tools/resolve-skill-path.sh"
fixture="$(mktemp -d)"
default_user_fixture=''
trap 'rm -rf "$fixture"; [ -z "$default_user_fixture" ] || rm -rf "$default_user_fixture"' EXIT
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

# The audit requires every shell module in tools/ to carry executable git mode.
[ "$(git -C "$repo_root" ls-files -s .claude/tools/resolve-skill-path.sh | awk '{print $1}')" = 100755 ]
checks=$((checks + 1))
# Exercise the real default user root without changing HOME or existing skills.
mkdir -p "$HOME/.agents/skills"
default_user_fixture="$(mktemp -d "$HOME/.agents/skills/resolver-fixture.XXXXXX")"
printf '# Default-user fixture\n' > "$default_user_fixture/SKILL.md"
[ "$(resolve_skill_path "$(basename "$default_user_fixture")" "$project_directory")" = "$default_user_fixture/SKILL.md" ]
checks=$((checks + 1))
# Run the actual audit against a minimal project, so reverting its agent or
# domain call sites to a single provider or directory-only checks fails here.
audit_project="$fixture/audit project"
mkdir -p "$audit_project/.claude/tools" "$audit_project/.claude/agents" "$audit_project/.claude/rules" "$audit_project/.github" "$audit_project/tools/agentic-sync" "$audit_project/scripts" "$audit_project/docs"
cp "$repo_root/.claude/tools/dx-audit.sh" "$repo_root/.claude/tools/resolve-skill-path.sh" "$audit_project/.claude/tools/"
chmod +x "$audit_project/.claude/tools/"*.sh
for config in .cursorrules GEMINI.md AGENTS.md .github/copilot-instructions.md; do
  printf 'rust-engine frontend mcp-commands testing docs design validate-\n' > "$audit_project/$config"
done
printf 'model: sonnet\nskills: [frontend, design]\n' > "$audit_project/.claude/agents/fixture.md"
for doc in README.md docs/known-limitations.md .claude/CLAUDE.md; do printf '# Fixture\n' > "$audit_project/$doc"; done
for rule in bevy-api.md entity-snapshot.md web-quality.md library-apis.md file-map.md; do printf '# Fixture\n' > "$audit_project/.claude/rules/$rule"; done
printf '// Fixture\n' > "$audit_project/tools/agentic-sync/sync.mjs"
printf '{}\n' > "$audit_project/tools/agentic-sync/canonical.json"
printf '#!/usr/bin/env bash\nexit 0\n' > "$audit_project/scripts/check-agentic-sync.sh"
mkdir -p "$audit_project/.claude/skills/frontend" "$audit_project/.agents/skills/frontend" "$audit_project/.codex/skills/design"
printf '# Fixture validate-\n' > "$audit_project/.agents/skills/frontend/SKILL.md"
printf '# Fixture validate-\n' > "$audit_project/.codex/skills/design/SKILL.md"
bash "$audit_project/.claude/tools/dx-audit.sh" > "$fixture/audit-positive.log"
grep -Fq 'fixture agent: all 2 skills resolve' "$fixture/audit-positive.log"
grep -Fq 'frontend skill exists' "$fixture/audit-positive.log"
grep -Fq 'design skill exists' "$fixture/audit-positive.log"
checks=$((checks + 3))
rm "$audit_project/.agents/skills/frontend/SKILL.md"
if bash "$audit_project/.claude/tools/dx-audit.sh" > "$fixture/audit-negative.log"; then
  echo 'Actual audit accepted a malformed skill directory' >&2; exit 1
fi
grep -Fq 'fixture agent: skills do not resolve: frontend' "$fixture/audit-negative.log"
grep -Fq 'frontend skill missing' "$fixture/audit-negative.log"
checks=$((checks + 2))
# Pin the executable fixture step and its owning job, rather than accepting a
# comment containing the command or a disabled sibling with the same name.
workflow="$repo_root/.github/workflows/ci.yml"
step="$(awk '/^  lockfile-sync-tests:/{job=1;next} job && /^  [a-zA-Z0-9_-]+:/{job=0} job && /^      - name: Run provider skill resolver fixtures$/{found=1;print;next} found{if(/^      - /)exit;print}' "$workflow")"
[ "$step" = "$(printf '      - name: Run provider skill resolver fixtures\n        run: bash scripts/__tests__/resolve-skill-path.test.sh')" ]
checks=$((checks + 1))

printf 'PASS: %s provider skill resolution checks\n' "$checks"
