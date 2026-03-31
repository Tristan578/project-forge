#!/usr/bin/env bash
# pr-green-machine: Get a full status snapshot of a pull request.
# Usage: bash "${CLAUDE_SKILL_DIR}/scripts/pr-status.sh" <pr-number>

set -euo pipefail

PR_NUMBER="${1:-}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

if [ -z "$PR_NUMBER" ]; then
  echo "Usage: bash pr-status.sh <pr-number>"
  echo "Example: bash pr-status.sh 7391"
  exit 1
fi

echo "=============================================="
echo "  PR #${PR_NUMBER} Status"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "=============================================="

# ---------------------------------------------------------------------------
# 1. Basic PR info
# ---------------------------------------------------------------------------
echo -e "\n${CYAN}=== PR Info ===${NC}"

PR_JSON=$(gh pr view "$PR_NUMBER" \
  --json title,headRefName,baseRefName,state,mergeable,mergeStateStatus,reviewDecision,isDraft \
  2>/dev/null || echo "{}")

if [ "$PR_JSON" = "{}" ]; then
  echo -e "  ${RED}ERROR: Could not fetch PR #${PR_NUMBER}${NC}"
  echo "  Check: gh auth status, PR number is correct, repo is correct"
  exit 1
fi

TITLE=$(echo "$PR_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('title','unknown'))" 2>/dev/null || echo "unknown")
HEAD=$(echo "$PR_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('headRefName','unknown'))" 2>/dev/null || echo "unknown")
BASE=$(echo "$PR_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('baseRefName','unknown'))" 2>/dev/null || echo "unknown")
STATE=$(echo "$PR_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('state','unknown'))" 2>/dev/null || echo "unknown")
MERGEABLE=$(echo "$PR_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('mergeable','unknown'))" 2>/dev/null || echo "unknown")
MERGE_STATE=$(echo "$PR_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('mergeStateStatus','unknown'))" 2>/dev/null || echo "unknown")
REVIEW_DECISION=$(echo "$PR_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('reviewDecision') or 'NONE')" 2>/dev/null || echo "unknown")
IS_DRAFT=$(echo "$PR_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('isDraft',False))" 2>/dev/null || echo "False")

echo "  Title:   ${TITLE}"
echo "  Branch:  ${HEAD} → ${BASE}"
echo "  State:   ${STATE}"
echo -n "  Base:    "
if [ "$BASE" = "main" ]; then
  echo -e "${GREEN}main (correct)${NC}"
else
  echo -e "${YELLOW}${BASE} — verify this is the right base branch${NC}"
fi

echo -n "  Draft:   "
[ "$IS_DRAFT" = "True" ] && echo -e "${YELLOW}YES — not ready for merge${NC}" || echo "no"

# ---------------------------------------------------------------------------
# 2. Merge conflicts
# ---------------------------------------------------------------------------
echo -e "\n${CYAN}=== Merge Status ===${NC}"

echo -n "  Mergeable:    "
case "$MERGEABLE" in
  "MERGEABLE")   echo -e "${GREEN}YES${NC}" ;;
  "CONFLICTING") echo -e "${RED}NO — has merge conflicts (rebase needed)${NC}" ;;
  *)             echo -e "${YELLOW}${MERGEABLE}${NC}" ;;
esac

echo -n "  Merge state:  "
case "$MERGE_STATE" in
  "CLEAN")          echo -e "${GREEN}CLEAN — ready to merge${NC}" ;;
  "BLOCKED")        echo -e "${YELLOW}BLOCKED — failing checks or missing review${NC}" ;;
  "BEHIND")         echo -e "${YELLOW}BEHIND — needs rebase onto base branch${NC}" ;;
  "DIRTY")          echo -e "${RED}DIRTY — has merge conflicts${NC}" ;;
  "UNSTABLE")       echo -e "${YELLOW}UNSTABLE — some checks failing${NC}" ;;
  *)                echo "${MERGE_STATE}" ;;
esac

echo -n "  Review:       "
case "$REVIEW_DECISION" in
  "APPROVED")            echo -e "${GREEN}APPROVED${NC}" ;;
  "CHANGES_REQUESTED")   echo -e "${RED}CHANGES REQUESTED${NC}" ;;
  "REVIEW_REQUIRED")     echo -e "${YELLOW}REVIEW REQUIRED${NC}" ;;
  "NONE"|"")             echo "no review yet" ;;
  *)                     echo "${REVIEW_DECISION}" ;;
esac

# ---------------------------------------------------------------------------
# 3. CI checks
# ---------------------------------------------------------------------------
echo -e "\n${CYAN}=== CI Checks ===${NC}"

set +e
CHECKS_OUTPUT=$(gh pr checks "$PR_NUMBER" 2>&1)
CHECKS_EXIT=$?
set -e

if [ "$CHECKS_EXIT" -ne 0 ]; then
  echo "  Could not fetch checks: ${CHECKS_OUTPUT}"
else
  TOTAL=$(echo "$CHECKS_OUTPUT" | grep -v "^$" | grep -v "^no checks" | wc -l | tr -d ' ')
  PASSING=$(echo "$CHECKS_OUTPUT" | grep -c "pass\|✓\|success\|completed" 2>/dev/null || echo "0")
  FAILING=$(echo "$CHECKS_OUTPUT" | grep -c "fail\|✗\|error\|failure" 2>/dev/null || echo "0")
  PENDING=$(echo "$CHECKS_OUTPUT" | grep -c "pending\|in_progress\|queued" 2>/dev/null || echo "0")

  echo "  Checks: ${TOTAL} total / ${PASSING} passing / ${FAILING} failing / ${PENDING} pending"
  echo ""

  if [ "$FAILING" -gt 0 ]; then
    echo -e "  ${RED}Failing checks:${NC}"
    echo "$CHECKS_OUTPUT" | grep "fail\|✗\|error\|failure" | head -10 | sed 's/^/    /'
    echo ""
    echo "  To investigate: gh run view <RUN_ID> --log-failed"
  fi

  if [ "$PENDING" -gt 0 ]; then
    echo -e "  ${YELLOW}Pending checks — CI still running${NC}"
  fi

  if [ "$FAILING" -eq 0 ] && [ "$PENDING" -eq 0 ]; then
    echo -e "  ${GREEN}All checks passing${NC}"
  fi
fi

# ---------------------------------------------------------------------------
# 4. Review comments (check for unanswered Sentry-like comments)
# ---------------------------------------------------------------------------
echo -e "\n${CYAN}=== Review Comments ===${NC}"

set +e
COMMENT_COUNT=$(gh pr view "$PR_NUMBER" --json comments \
  --jq '.comments | length' 2>/dev/null || echo "unknown")
set -e

echo "  Total comments: ${COMMENT_COUNT}"

# Check for sentry bot comments
set +e
SENTRY_COMMENTS=$(gh api "repos/:owner/:repo/pulls/${PR_NUMBER}/comments" 2>/dev/null \
  | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    sentry = [c for c in data if 'sentry' in c.get('user',{}).get('login','').lower()]
    print(len(sentry))
except:
    print('0')
" 2>/dev/null || echo "0")
set -e

echo "  Sentry comments: ${SENTRY_COMMENTS}"
if [ "$SENTRY_COMMENTS" -gt 0 ] 2>/dev/null; then
  echo -e "  ${YELLOW}Review Sentry comments: each must get a reply with commit SHA, PF ticket, or false-positive explanation${NC}"
fi

# ---------------------------------------------------------------------------
# 5. Closes link check
# ---------------------------------------------------------------------------
echo -e "\n${CYAN}=== PR Body ===${NC}"

PR_BODY=$(gh pr view "$PR_NUMBER" --json body --jq '.body' 2>/dev/null || echo "")

if echo "$PR_BODY" | grep -qE "Closes #[0-9]+"; then
  ISSUE_NUM=$(echo "$PR_BODY" | grep -oE "Closes #[0-9]+" | head -1)
  echo -e "  ${GREEN}Has Closes link: ${ISSUE_NUM}${NC}"
else
  echo -e "  ${RED}MISSING Closes #NNNN link — CI will warn, required for tracking${NC}"
fi

# ---------------------------------------------------------------------------
# 6. Summary
# ---------------------------------------------------------------------------
echo ""
echo "=============================================="
echo "  TRIAGE SUMMARY"
echo "=============================================="

printf "  %-20s %-10s %s\n" "Check" "Status" "Action"
printf "  %-20s %-10s %s\n" "-----" "------" "------"

# Base branch
if [ "$BASE" = "main" ]; then
  printf "  %-20s ${GREEN}%-10s${NC} %s\n" "Base branch" "OK" ""
else
  printf "  %-20s ${YELLOW}%-10s${NC} %s\n" "Base branch" "WARN" "gh pr edit ${PR_NUMBER} --base main"
fi

# Merge conflicts
case "$MERGEABLE" in
  "MERGEABLE")   printf "  %-20s ${GREEN}%-10s${NC} %s\n" "Merge conflicts" "NONE" "" ;;
  "CONFLICTING") printf "  %-20s ${RED}%-10s${NC} %s\n" "Merge conflicts" "YES" "git fetch && git rebase origin/main" ;;
  *)             printf "  %-20s ${YELLOW}%-10s${NC} %s\n" "Merge conflicts" "$MERGEABLE" "Check after CI completes" ;;
esac

# CI
if [ "$CHECKS_EXIT" -eq 0 ] && [ "$FAILING" -eq 0 ] && [ "$PENDING" -eq 0 ]; then
  printf "  %-20s ${GREEN}%-10s${NC} %s\n" "CI checks" "PASSING" ""
elif [ "$PENDING" -gt 0 ] 2>/dev/null; then
  printf "  %-20s ${YELLOW}%-10s${NC} %s\n" "CI checks" "PENDING" "Wait for CI to complete"
elif [ "$FAILING" -gt 0 ] 2>/dev/null; then
  printf "  %-20s ${RED}%-10s${NC} %s\n" "CI checks" "FAILING" "See above"
else
  printf "  %-20s ${YELLOW}%-10s${NC} %s\n" "CI checks" "UNKNOWN" "Run: gh pr checks ${PR_NUMBER}"
fi

# Sentry
if [ "$SENTRY_COMMENTS" = "0" ] 2>/dev/null; then
  printf "  %-20s ${GREEN}%-10s${NC} %s\n" "Sentry comments" "NONE" ""
else
  printf "  %-20s ${YELLOW}%-10s${NC} %s\n" "Sentry comments" "${SENTRY_COMMENTS}" "Reply to each with SHA or false-positive reason"
fi

echo ""
