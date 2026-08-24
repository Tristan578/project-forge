#!/bin/bash
# PreToolUse hook (Edit|Write|Bash): inject relevant anti-patterns from lessons
# learned into the agent's context BEFORE any code modification.
#
# This is the CRITICAL enforcement mechanism: every agent — orchestrator or
# subagent — sees relevant anti-patterns before modifying code or running
# commands that touch files.
#
# TARGETING, in precedence order:
#   1. `**Applies:** <substr>|<substr>` on a lesson — an explicit, case-insensitive
#      SUBSTRING list matched against the target (file path, or the whole bash
#      command). Substrings, deliberately NOT regexes: an author typo in a regex
#      aborts awk mid-file and the hook silently injects nothing, which is the
#      one failure mode this hook must never have. Annotated lessons are emitted
#      FIRST so the match cap can never starve a precisely-targeted lesson.
#   2. Keyword-vs-prose matching (the table below) for un-annotated lessons, so a
#      newly added lesson is still picked up with no edit to this file.
#
# PERFORMANCE: the whole lessons file is matched in ONE awk pass. The previous
# implementation piped every line through `grep` in a shell while-loop — ~1,400
# forks per invocation, a 5.8s MEDIAN against a 5s timeout, so the hook was being
# KILLED (540 times in a 120-session window) and enforcement silently did not
# happen. Do not reintroduce a per-line fork.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

# Extract target: file_path for Edit/Write, command for Bash
if [ "$TOOL_NAME" = "Bash" ]; then
  TARGET=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  TARGET=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
fi

if [ -z "$TARGET" ]; then
  exit 0
fi

LESSONS="$HOME/.claude/projects/-Users-tristannolan-project-forge/memory/project_lessons_learned.md"

if [ ! -f "$LESSONS" ]; then
  exit 0
fi

# A read-only bash command gets NOTHING — not the fallback, not keyword
# matches. 60% of this hook's fires were `ls`/`cat`/`grep`/`git status`, each
# stamped MANDATORY with warnings about mistakes you cannot make by reading a
# file. 5,700 irrelevant mandatory blocks per month is how an agent learns to
# skim the block, which costs enforcement on the calls that DO matter. Editing
# the same path still warns; so does any command that can change state.
# Exiting here also skips ~19 greps, so the cheapest case is also the fastest.
if [ "$TOOL_NAME" = "Bash" ] && ! echo "$TARGET" | grep -qE '(^|[;&|[:space:]])(git[[:space:]]+(push|checkout|revert|reset|cherry-pick|commit|rebase|merge|branch|worktree|clean|stash)|gh[[:space:]]+(pr|issue|release|api)|vercel|wrangler|stripe|npm[[:space:]]+(install|ci|update|publish|uninstall)|npx[[:space:]]+changeset|db:(push|migrate|generate)|rm|mv|chmod|ln|tee)([[:space:]]|$)'; then
  exit 0
fi

# Build keyword list based on what's being touched
KEYWORDS=""

# --- File path patterns ---

# GitHub Actions / CI / CD workflows
if echo "$TARGET" | grep -qiE "\.github/workflows/|ci\.yml|cd\.yml|quality-gates"; then
  KEYWORDS="$KEYWORDS|artifact|download-artifact|upload-artifact|permissions|startup_failure|workflow|contents.write|reusable"
fi

# API routes
if echo "$TARGET" | grep -qiE "app/api/|route\.ts"; then
  KEYWORDS="$KEYWORDS|rateLimit|await|refund|captureException|try.catch"
fi

# Generate routes
if echo "$TARGET" | grep -qiE "api/generate/"; then
  KEYWORDS="$KEYWORDS|refund|maxDuration|token"
fi

# React components
if echo "$TARGET" | grep -qiE "components/.*\.tsx$"; then
  KEYWORDS="$KEYWORDS|panelRegistry|useRef|Date\.now|Math\.random|eslint-disable|setState"
fi

# Store slices
if echo "$TARGET" | grep -qiE "stores/|slices/"; then
  KEYWORDS="$KEYWORDS|nullish|NaN|Number\("
fi

# Chat handlers
if echo "$TARGET" | grep -qiE "chat/handlers/"; then
  KEYWORDS="$KEYWORDS|forge\.|parseArgs|executor"
fi

# Engine Rust files
if echo "$TARGET" | grep -qiE "engine/src/"; then
  KEYWORDS="$KEYWORDS|ParamSet|B0001|B0002|spawn_from_snapshot|EntitySnapshot|wasm_bindgen|bridge"
fi

# Panel registry specifically
if echo "$TARGET" | grep -qiE "panelRegistry"; then
  KEYWORDS="$KEYWORDS|panelRegistry|PANEL_COMPONENTS|closing"
fi

# Token/billing
if echo "$TARGET" | grep -qiE "tokens/|billing|pricing|credit"; then
  KEYWORDS="$KEYWORDS|refund|addon|monthly|transaction|atomic"
fi

# Database schema
if echo "$TARGET" | grep -qiE "db/schema|schema\.ts|migration|drizzle"; then
  KEYWORDS="$KEYWORDS|migration|schema|ALTER.TABLE|db\.push|transaction|neon-http"
fi

# Encryption / crypto
if echo "$TARGET" | grep -qiE "encryption|keys/|crypto"; then
  KEYWORDS="$KEYWORDS|IV_LENGTH|migration|backwards.compatible|decrypt"
fi

# Worktree / git operations
if echo "$TARGET" | grep -qiE "worktree|git.checkout|git.branch"; then
  KEYWORDS="$KEYWORDS|rebase.onto.main|nested.worktree|one.level.only|branch.from.feature"
fi

# Git push (PR validation)
if echo "$TARGET" | grep -qiE "git.push"; then
  KEYWORDS="$KEYWORDS|local.CI.validation|eslint.*tsc.*vitest|before.ANY.PR|consolidate.reviews"
fi

# Vercel CLI commands
if echo "$TARGET" | grep -qiE "vercel|deploy.*prod|vercel.link|vercel.project"; then
  KEYWORDS="$KEYWORDS|scope.tnolan|hobby.account|nolantj-livecoms|team_5SxqWz8y|NEVER.use.*hobby"
fi

# Export pipeline
if echo "$TARGET" | grep -qiE "export/"; then
  KEYWORDS="$KEYWORDS|injection|sanitize|bgColor|script.tag|loop.guard"
fi

# Test files
if echo "$TARGET" | grep -qiE "\.test\.|\.spec\."; then
  KEYWORDS="$KEYWORDS|vi\.mock|resetModules|restoreAllMocks|dynamic.import"
fi

# Scripting / forge API
if echo "$TARGET" | grep -qiE "scripting/|forgeTypes"; then
  KEYWORDS="$KEYWORDS|forge\.|namespace|property.vs.function"
fi

# Next.js layouts
if echo "$TARGET" | grep -qiE "layout\.tsx$"; then
  KEYWORDS="$KEYWORDS|force-dynamic|ClerkProvider"
fi

# PR creation commands
if echo "$TARGET" | grep -qiE "gh pr create|gh pr "; then
  KEYWORDS="$KEYWORDS|Closes|issue.number|sync-push"
fi

# Git operations
if echo "$TARGET" | grep -qiE "git (checkout|revert|reset|cherry-pick)"; then
  KEYWORDS="$KEYWORDS|artifact|permissions|version|@v4|@v8"
fi

# --- Bash command patterns ---
if [ "$TOOL_NAME" = "Bash" ]; then
  # Git checkout of workflow files
  if echo "$TARGET" | grep -qiE "checkout.*\.github|checkout.*workflow"; then
    KEYWORDS="$KEYWORDS|artifact|download-artifact|upload-artifact|permissions|startup_failure|contents.write|@v4|@v8"
  fi
  # Any git revert/reset that could reintroduce old bugs
  if echo "$TARGET" | grep -qiE "git (revert|reset|cherry-pick)"; then
    KEYWORDS="$KEYWORDS|artifact|permissions|startup_failure|panelRegistry"
  fi
fi

# If no branch matched, fall back to the universal top lessons.
if [ -z "$KEYWORDS" ]; then
  KEYWORDS="panelRegistry|rateLimit|nullish|refund|await"
fi

# Strip leading pipe
KEYWORDS="${KEYWORDS#|}"

# Single-pass match. Emits `**Applies:**`-targeted lessons first, then
# keyword-vs-prose matches, capped at MAX total.
#
# KW/TARGET go through the ENVIRONMENT, not `awk -v`: -v processes escape
# sequences in the value, so the keyword `Number\(` arrives as `Number(` — an
# unmatched paren, an illegal ERE, and awk aborts mid-file. The hook then exits
# 0 with empty output and the operation proceeds unwarned. That is this hook's
# worst failure mode, so the awk status is checked below rather than swallowed.
export LL_KW="$KEYWORDS" LL_TARGET="$TARGET"
WARNINGS=$(awk '
BEGIN {
  nk = split(ENVIRON["LL_KW"], K, "|")
  lt = tolower(ENVIRON["LL_TARGET"])
  MAX = 12
  na = 0; nb = 0
}
/^### [0-9]+\. / {
  classify()
  title = substr($0, 5); block = $0; prev = ""; applies = ""
  next
}
{
  block = block " " $0
  if (index($0, "**Prevention:**") == 1) prev = substr($0, 17)
  else if (index($0, "**Applies:**") == 1) applies = substr($0, 14)
}
END {
  classify()
  n = 0
  for (i = 1; i <= na && n < MAX; i++) { print A[i]; n++ }
  for (i = 1; i <= nb && n < MAX; i++) { print B[i]; n++ }
}
# Route the block just finished into the Applies list, the keyword list, or neither.
function classify(   i, np, part, p, cut, line) {
  if (title == "") return
  p = prev
  if (length(p) > 200) {
    # Cut back to the last space rather than slicing at exactly 200. awk on macOS
    # counts BYTES, so a hard cut can land inside a multi-byte character (the
    # lessons prose is full of em dashes) and emit invalid UTF-8.
    cut = substr(p, 1, 200)
    if (match(cut, /^.*[ \t]/)) cut = substr(cut, 1, RLENGTH - 1)
    p = cut "..."
  }
  line = "- " title ": " p

  if (applies != "") {
    # Explicit targeting wins outright: substring match, no regex, no fallthrough
    # to prose keywords (an annotated lesson has already said where it applies).
    np = split(tolower(applies), part, "|")
    for (i = 1; i <= np; i++) {
      gsub(/^[ \t]+|[ \t]+$/, "", part[i])
      if (part[i] != "" && index(lt, part[i]) > 0) { A[++na] = line; return }
    }
    return
  }

  for (i = 1; i <= nk; i++) {
    if (K[i] == "") continue
    if (tolower(block) ~ tolower(K[i])) { B[++nb] = line; return }
  }
}
' "$LESSONS" 2>/dev/null)
AWK_STATUS=$?
unset LL_KW LL_TARGET

# A malformed keyword regex aborts awk mid-file. Never let that pass silently as
# "no lessons apply" — an unwarned edit is exactly what this hook exists to stop.
if [ "$AWK_STATUS" -ne 0 ]; then
  echo "LESSONS HOOK FAILED (awk exit $AWK_STATUS) — anti-pattern warnings were NOT injected for this operation."
  echo "Fix the keyword table in .claude/hooks/inject-lessons-learned.sh, then re-run:"
  echo "  bash .claude/hooks/__tests__/inject-lessons-learned.test.sh"
  exit 0
fi

if [ -n "$WARNINGS" ]; then
  echo "MANDATORY — Lessons learned relevant to this operation. Violating these has caused real bugs:"
  echo "$WARNINGS"
fi

exit 0
