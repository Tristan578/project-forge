#!/usr/bin/env bash
# Contract test for .claude/tools/dx-audit.sh — specifically the cross-provider
# coverage added alongside the agentic-config source-of-truth gate (SSoT#2).
#
# The DX audit is a local developer-ergonomics tool: running it must surface
# (a) the secondary provider surfaces beyond the four primary IDE configs
# (.codex/AGENTS.md, .windsurf, .agents) and (b) any drift between those
# configs and tools/agentic-sync/canonical.json — by INVOKING the already-
# unit-tested scripts/check-agentic-sync.sh rather than re-implementing the
# check. This suite pins that wiring so a refactor cannot silently drop the
# agentic source-of-truth section from the audit.
#
# Mostly structural (grep on the script) so it is hermetic and fast; plus one
# behavioural assertion that the audit actually runs the agentic section and
# the gate passes against the in-sync repo. The audit's overall exit code is
# tolerated (it reports unrelated repo state too) — we assert only on the
# agentic section, which is what this change owns.
#
# Assertions use explicit if/then/else (NOT `A && ok || bad`) so this suite has
# no SC2015 findings — CI's self-defense job lints it with shellcheck.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
AUDIT="$REPO_ROOT/.claude/tools/dx-audit.sh"

# --- host guards -------------------------------------------------------------
command -v node >/dev/null 2>&1 || { echo "FATAL: node not found on host"; exit 1; }
command -v grep >/dev/null 2>&1 || { echo "FATAL: grep not found on host"; exit 1; }

PASS=0
FAIL=0
ok()  { echo "  ok: $1"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

echo "== dx-audit: file existence =="
if [ -f "$AUDIT" ]; then ok "dx-audit.sh exists"; else bad "dx-audit.sh missing"; fi
if [ -x "$AUDIT" ]; then ok "dx-audit.sh is executable"; else bad "dx-audit.sh is not executable"; fi

echo "== dx-audit: wires the agentic source-of-truth gate (SSoT#2) =="
# It must DELEGATE to the tested gate, not re-implement the check.
if grep -q "check-agentic-sync.sh" "$AUDIT"; then ok "audit invokes scripts/check-agentic-sync.sh"; else bad "audit does not reference the agentic gate"; fi
if grep -q "tools/agentic-sync" "$AUDIT"; then ok "audit references the canonical source-of-truth dir"; else bad "audit does not reference tools/agentic-sync"; fi

echo "== dx-audit: covers the secondary provider surfaces =="
if grep -q "\.codex/AGENTS\.md" "$AUDIT"; then ok "audit covers .codex/AGENTS.md"; else bad "audit does not cover .codex/AGENTS.md"; fi
if grep -q "\.windsurf" "$AUDIT"; then ok "audit covers the .windsurf surface"; else bad "audit does not cover .windsurf"; fi
if grep -q "\.agents" "$AUDIT"; then ok "audit covers the .agents surface"; else bad "audit does not cover .agents"; fi

echo "== dx-audit: behavioural — agentic section runs and passes on the in-sync repo =="
# Default `audit` mode does only file/grep checks (no network), so this is fast.
# Tolerate the overall exit code; assert only on the agentic section.
audit_out="$(bash "$AUDIT" audit 2>&1 || true)"
if echo "$audit_out" | grep -qi "agentic"; then ok "audit output includes an agentic source-of-truth section"; else bad "audit output has no agentic section"; fi
if echo "$audit_out" | grep -qi "agentic config.*sync\|in sync with .*canonical"; then ok "audit reports the agentic config in sync"; else bad "audit did not report agentic sync status"; fi

echo "== structural: this suite is wired into CI (anti-unwiring) =="
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
# A dx-audit.sh edit matches neither `ci` nor `hooks`, so the agentic path output
# is the ONLY thing that re-runs this suite — pin both the trigger and the run step.
if grep -q "dx-audit\.test\.sh" "$CI_YML"; then ok "ci.yml runs the dx-audit contract test"; else bad "ci.yml does not run this suite"; fi
if grep -q "dx-audit\.sh" "$CI_YML"; then ok "ci.yml references dx-audit.sh (trigger + shellcheck)"; else bad "ci.yml does not reference dx-audit.sh"; fi

echo ""
echo "  PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || { echo "SUITE FAILED"; exit 1; }
echo "SUITE PASSED"
