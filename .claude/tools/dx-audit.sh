#!/usr/bin/env bash
# Developer Experience Audit — checks cross-IDE consistency, tool health, doc freshness
# Used by: developer-experience skill, session start hook, other agents
# Usage: bash .claude/tools/dx-audit.sh [audit|onboard]
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_ROOT"

MODE="${1:-audit}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ISSUES=0
WARNINGS=0

pass() { echo -e "  ${GREEN}PASS${NC}: $1"; }
fail() { echo -e "  ${RED}FAIL${NC}: $1"; ISSUES=$((ISSUES + 1)); }
warn() { echo -e "  ${YELLOW}WARN${NC}: $1"; WARNINGS=$((WARNINGS + 1)); }
section() { echo -e "\n${CYAN}--- $1 ---${NC}"; }

echo "=============================================="
echo "  SpawnForge Developer Experience Audit"
echo "  Mode: $MODE"
echo "=============================================="

# ============================================
# 1. Cross-IDE Config Consistency
# ============================================
section "Cross-IDE Config Consistency"

IDE_CONFIGS=(".cursorrules" "GEMINI.md" "AGENTS.md" ".github/copilot-instructions.md")
for config in "${IDE_CONFIGS[@]}"; do
  if [ -f "$PROJECT_ROOT/$config" ]; then
    pass "$config exists"
  else
    fail "$config missing"
  fi
done

# Check that all configs reference domain skills
SKILLS=("rust-engine" "frontend" "mcp-commands" "testing" "docs" "design")
for config in "${IDE_CONFIGS[@]}"; do
  if [ -f "$PROJECT_ROOT/$config" ]; then
    MISSING_REFS=""
    for skill in "${SKILLS[@]}"; do
      if ! grep -q "$skill" "$PROJECT_ROOT/$config" 2>/dev/null; then
        MISSING_REFS="$MISSING_REFS $skill"
      fi
    done
    if [ -n "$MISSING_REFS" ]; then
      warn "$config missing skill references:$MISSING_REFS"
    fi
  fi
done

# Check that all configs reference validation tools
for config in "${IDE_CONFIGS[@]}"; do
  if [ -f "$PROJECT_ROOT/$config" ]; then
    if grep -q "validate-" "$PROJECT_ROOT/$config" 2>/dev/null; then
      pass "$config references validation tools"
    else
      warn "$config does not reference validation tools"
    fi
  fi
done

# ============================================
# 2. Validation Script Health
# ============================================
section "Validation Script Health"

TOOLS_DIR="$PROJECT_ROOT/.claude/tools"
if [ -d "$TOOLS_DIR" ]; then
  for script in "$TOOLS_DIR"/*.sh; do
    [ -f "$script" ] || continue
    name=$(basename "$script")
    if [ -x "$script" ]; then
      pass "$name is executable"
    else
      fail "$name is not executable"
    fi
  done
else
  fail ".claude/tools/ directory missing"
fi

# ============================================
# 3. Agent Profile Health
# ============================================
section "Agent Profiles"

AGENTS_DIR="$PROJECT_ROOT/.claude/agents"
VALID_MODELS=("opus" "sonnet" "haiku")
if [ -d "$AGENTS_DIR" ]; then
  for agent in "$AGENTS_DIR"/*.md; do
    name=$(basename "$agent" .md)
    # Check model field
    model=$(grep "^model:" "$agent" 2>/dev/null | awk '{print $2}' || echo "")
    if [ -n "$model" ]; then
      valid=false
      for m in "${VALID_MODELS[@]}"; do
        if [ "$model" = "$m" ]; then valid=true; break; fi
      done
      if $valid; then
        pass "$name agent: model=$model"
      else
        fail "$name agent: invalid model '$model'"
      fi
    else
      warn "$name agent: no model specified"
    fi

    # Check skills reference existing dirs
    skills_line=$(grep "^skills:" "$agent" 2>/dev/null || echo "")
    if [ -n "$skills_line" ]; then
      pass "$name agent: has skills defined"
    else
      warn "$name agent: no skills referenced"
    fi
  done
else
  fail ".claude/agents/ directory missing"
fi

# ============================================
# 4. Domain Skills Health
# ============================================
section "Domain Skills"

SKILLS_DIR="$PROJECT_ROOT/.claude/skills"
for skill in rust-engine frontend mcp-commands testing docs design developer-experience; do
  skill_file="$SKILLS_DIR/$skill/SKILL.md"
  if [ -f "$skill_file" ]; then
    pass "$skill skill exists"
    # Check for validation tool references
    if grep -q "validate-\|\.claude/tools/" "$skill_file" 2>/dev/null; then
      pass "$skill skill references validation tools"
    else
      warn "$skill skill has no validation tool references"
    fi
  else
    warn "$skill skill missing"
  fi
done

# ============================================
# 5. Documentation Freshness
# ============================================
section "Documentation Freshness"

# Required docs
for doc in README.md docs/known-limitations.md .claude/CLAUDE.md; do
  if [ -f "$PROJECT_ROOT/$doc" ]; then
    pass "$doc exists"
  else
    fail "$doc missing"
  fi
done

# Rules files
for rule in bevy-api.md entity-snapshot.md web-quality.md library-apis.md file-map.md; do
  if [ -f "$PROJECT_ROOT/.claude/rules/$rule" ]; then
    pass ".claude/rules/$rule exists"
  else
    fail ".claude/rules/$rule missing"
  fi
done

# MCP manifest sync
MCP="$PROJECT_ROOT/mcp-server/manifest/commands.json"
WEB="$PROJECT_ROOT/web/src/data/commands.json"
if [ -f "$MCP" ] && [ -f "$WEB" ]; then
  if diff -q "$MCP" "$WEB" > /dev/null 2>&1; then
    pass "MCP manifests in sync"
  else
    fail "MCP manifests out of sync"
  fi
fi

# Stale version references
STALE_BEVY=$(grep -rn "Bevy 0\." README.md .claude/CLAUDE.md 2>/dev/null | grep -v "0\.18" | head -3)
if [ -n "$STALE_BEVY" ]; then
  warn "Stale Bevy version references found (not 0.18)"
fi

# ============================================
# 6. Hook Scripts
# ============================================
section "Hook Scripts"

HOOKS_DIR="$PROJECT_ROOT/.claude/hooks"
for hook in on-session-start.sh on-stop.sh on-prompt-submit.sh post-edit-lint.sh worktree-safety-commit.sh; do
  if [ -f "$HOOKS_DIR/$hook" ]; then
    if [ -x "$HOOKS_DIR/$hook" ]; then
      pass "$hook exists and is executable"
    else
      warn "$hook exists but is not executable"
    fi
  else
    warn "$hook missing from .claude/hooks/"
  fi
done

# ============================================
# 7. Onboard Mode Extras
# ============================================
if [ "$MODE" = "onboard" ]; then
  section "Onboarding Prerequisites"

  # Check node/npm
  if command -v node > /dev/null 2>&1; then
    pass "node available: $(node --version)"
  else
    fail "node not found"
  fi

  if command -v npm > /dev/null 2>&1; then
    pass "npm available: $(npm --version)"
  else
    fail "npm not found"
  fi

  # Check rust
  if command -v rustc > /dev/null 2>&1; then
    pass "rustc available: $(rustc --version | head -1)"
  else
    warn "rustc not found (needed for WASM builds)"
  fi

  # Check wasm-bindgen
  if command -v wasm-bindgen > /dev/null 2>&1; then
    WB_VER=$(wasm-bindgen --version 2>/dev/null | head -1)
    if echo "$WB_VER" | grep -q "0.2.108"; then
      pass "wasm-bindgen 0.2.108: $WB_VER"
    else
      warn "wasm-bindgen version mismatch: $WB_VER (need 0.2.108)"
    fi
  else
    warn "wasm-bindgen not found (needed for WASM builds)"
  fi

  # Check python3
  if command -v python3 > /dev/null 2>&1; then
    pass "python3 available"
  else
    warn "python3 not found (needed for arch-validator and sync scripts)"
  fi

  # Check web dependencies
  if [ -d "$PROJECT_ROOT/web/node_modules" ]; then
    pass "web/node_modules exists"
  else
    warn "web/node_modules missing (run: cd web && npm install)"
  fi

  # Check taskboard
  if curl -s http://localhost:3010/api/health > /dev/null 2>&1; then
    pass "Taskboard server running at :3010"
  else
    warn "Taskboard not running (run: taskboard start --port 3010 --db .claude/taskboard.db)"
  fi
fi

# ============================================
# Summary
# ============================================
echo ""
echo "=============================================="
if [ "$ISSUES" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
  echo -e "  ${GREEN}DX AUDIT PASSED${NC} — zero issues"
elif [ "$ISSUES" -eq 0 ]; then
  echo -e "  ${YELLOW}DX AUDIT: $WARNINGS warning(s)${NC}"
else
  echo -e "  ${RED}DX AUDIT: $ISSUES issue(s), $WARNINGS warning(s)${NC}"
fi
echo "=============================================="

exit "$ISSUES"
