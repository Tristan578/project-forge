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

# RESOLUTION IS REPO-RELATIVE AND CONTAINS NO USERNAME.
#
# This line used to read
#   $HOME/.claude/projects/-Users-tristannolan-project-forge/memory/...
# which embedded one machine's username and a macOS-style project slug. On every
# other machine it resolved to nothing, the `exit 0` below was taken, and this
# hook -- the enforcement mechanism eight subagents are told to rely on --
# injected NOTHING, silently, for entire sessions (#9605).
#
# Order: an explicit override (tests), then the repo copy. The legacy user-level
# location is still honoured for machines that have it, but matched by GLOB so
# no username is baked in ever again.
resolve_lessons() {
  if [ -n "${LESSONS_FILE:-}" ]; then
    printf '%s' "$LESSONS_FILE"
    return
  fi
  # Derived from this script's own location -- NO subprocess. `git rev-parse`
  # would work, but it forks on every Edit/Write/mutating-Bash call, and this
  # hook runs under a 5s timeout that it has already blown once in its history
  # (the per-line grep loop, 540 kills in a 120-session window). On Windows a
  # single fork is ~200ms of that budget. The hook lives at
  # <repo>/.claude/hooks/, so the repo copy is two directories up.
  local self_dir
  self_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
  if [ -n "$self_dir" ] && [ -f "$self_dir/../rules/lessons-learned.md" ]; then
    printf '%s' "$self_dir/../rules/lessons-learned.md"
    return
  fi
  local legacy
  for legacy in "$HOME"/.claude/projects/*/memory/project_lessons_learned.md; do
    if [ -f "$legacy" ]; then
      printf '%s' "$legacy"
      return
    fi
  done
  printf ''
}

LESSONS="$(resolve_lessons)"

# LOUD, NOT SILENT. The awk-abort path below already refuses to pass unnoticed,
# on the grounds that "an unwarned edit is exactly what this hook exists to
# stop". A missing lessons file has the identical consequence and had the
# opposite handling: a bare `exit 0`. That asymmetry is how enforcement stayed
# dead through a whole session while the hook's own test reported success.
if [ -z "$LESSONS" ] || [ ! -f "$LESSONS" ]; then
  echo "LESSONS HOOK DISABLED — no lessons file found, so anti-pattern warnings were NOT injected for this operation."
  echo "Expected at: <repo>/.claude/rules/lessons-learned.md (override with \$LESSONS_FILE)."
  echo "Restore it before relying on this hook; it fails open by design and will not block you."
  exit 0
fi

# A read-only bash command gets NOTHING — not the fallback, not keyword
# matches. 60% of this hook's fires were `ls`/`cat`/`grep`/`git status`, each
# stamped MANDATORY with warnings about mistakes you cannot make by reading a
# file. 5,700 irrelevant mandatory blocks per month is how an agent learns to
# skim the block, which costs enforcement on the calls that DO matter.
#
# This is an ALLOWLIST of known read-only commands, not a denylist of known
# mutating ones: a denylist only ever catches verbs someone remembered to add
# — `sed -i`, `cp`, `mkdir`, `touch` and a plain `>` redirect all slipped
# through the previous denylist and silently skipped injection, and any newly
# invented command starts out missing from a denylist too. An allowlist
# defaults the other way: anything not explicitly known to be read-only falls
# through to keyword matching (worst case, the universal fallback), so an
# unrecognized command warns instead of silently passing.
#
# Three properties this gate MUST keep, each of which a naive allowlist gets
# wrong:
#   1. EVERY segment must be read-only, not merely one of them. A single grep
#      over the whole string matches the `; ls` in `rm -rf build; ls` and
#      would skip injection on a command that deletes a directory. The command
#      is split on `;`/`&`/`|` and each segment is anchored with `^`.
#   2. A verb is not a permission — the SUBCOMMAND and flags decide. `git
#      branch` reads, `git branch -d x` deletes; `npx eslint` reads, `npx
#      eslint --fix` rewrites source. Allowlist entries name the read-only
#      forms explicitly, and anything unlisted falls through.
#   3. Some tokens mutate regardless of the leading verb — a `>` redirect,
#      `tee`, an in-place `find` action, `--fix`/`--write`/`--update`, or a
#      `$(...)`/backtick substitution whose inner command is never inspected.
#      Those are checked first and force fallthrough unconditionally.
# Exiting here also skips ~19 greps, so the cheapest case is also the fastest.
# `sed -i` has to be listed here rather than excluded from READONLY_SEGMENT_RE:
# ERE has no negative lookahead, so the read-only `sed -n` alternative cannot say
# "unless -i appears later" and `sed -n -i s/a/b/ f` matched it as read-only.
# The flag is matched only when `sed` leads the segment — a bare `-i` would
# reclassify `grep -i`, which is read-only and ubiquitous. `-[a-zA-Z]*i` covers
# the combined and suffixed forms (`-ni`, `-i.bak`); `--in-place` is spelled out
# because its second character is a dash.
MUTATES_REGARDLESS_RE='>|(^|[[:space:]])tee([[:space:]]|$)|(^|[[:space:]])-(delete|exec|execdir|ok|okdir)([[:space:]]|$)|(^|[[:space:]])sed[[:space:]]+(-[^[:space:]]+[[:space:]]+)*(--in-place|-[a-zA-Z]*i)|--fix|--write|--update|\$\(|`'
READONLY_SEGMENT_RE='^[[:space:]]*(cat|ls|head|tail|wc|pwd|whoami|which|type|file|stat|jq|sort|uniq|column|basename|dirname|date|grep|egrep|fgrep|rg|awk|printf|echo|diff|find|tree|sed[[:space:]]+-n|git[[:space:]]+(status|log|diff|show|blame|rev-parse|describe|ls-files|stash[[:space:]]+list|branch[[:space:]]+(--show-current|--list|-a|-r|-v)|remote[[:space:]]+(-v|show))|npm[[:space:]]+(ls|view|outdated)|npx[[:space:]]+(vitest[[:space:]]+run|eslint|tsc)|gh[[:space:]]+(pr[[:space:]]+(view|list|checks|diff)|issue[[:space:]]+(view|list)|run[[:space:]]+(list|view)))([[:space:]]|$)'

is_readonly_bash() {
  local cmd="$1" seg
  if echo "$cmd" | grep -qE "$MUTATES_REGARDLESS_RE"; then
    return 1
  fi
  while IFS= read -r seg; do
    # `env -u VAR`/`VAR=x` prefixes are transparent — the command after them
    # is what decides. `env -u UPSTASH_REDIS_REST_URL npx vitest run` is the
    # canonical local test invocation and must stay silent.
    seg=$(echo "$seg" | sed -E 's/^[[:space:]]*env([[:space:]]+-u[[:space:]]+[A-Za-z_][A-Za-z0-9_]*|[[:space:]]+[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*)+[[:space:]]+//')
    case "$seg" in
      *[![:space:]]*) ;;
      *) continue ;;
    esac
    echo "$seg" | grep -qE "$READONLY_SEGMENT_RE" || return 1
  done <<EOF
$(echo "$cmd" | tr ';&|' '\n')
EOF
  return 0
}

if [ "$TOOL_NAME" = "Bash" ] && is_readonly_bash "$TARGET"; then
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
