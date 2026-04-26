#!/usr/bin/env bash
# PostCompact hook: re-inject the most load-bearing project rules after auto-
# compaction. CLAUDE.md and .claude/rules/*.md only load on SessionStart — they
# fall out of context after compaction and the agent drifts into deprecated
# patterns.
#
# Why a digest, not a dump: hook stdout is capped at 10,000 chars (truncated
# silently). The full rule set is ~47KB, so a raw `cat` blew the budget and the
# tail (often the most critical gotchas) was dropped. We emit a compact pointer
# table plus the highest-frequency reminders inline, and tell the agent to Read
# the specific rule file when it needs detail. Stays well under 5KB combined
# with restore-context-hints.sh.
#
# Stays well under the 5s hook timeout: no I/O beyond a stat per rule file.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
if [ -z "$REPO_ROOT" ] || [ ! -d "$REPO_ROOT/.claude/rules" ]; then
  exit 0
fi

shopt -s nullglob
RULES=("$REPO_ROOT"/.claude/rules/*.md)
if [ ${#RULES[@]} -eq 0 ]; then
  exit 0
fi

cat <<'EOF'
=== Project Rules Re-Injected After Compaction ===

The full rule set normally loads via SessionStart but is dropped during
compaction. Treat the items below with the same authority as CLAUDE.md.

# Top-frequency anti-patterns (fix at the source, never with --no-verify)

- panelRegistry.ts: read 10 lines before AND after insertion point. Run
  `npx vitest run src/lib/workspace/__tests__/panelRegistry.test.ts` after.
- `rateLimitPublicRoute()` is async — every call site needs `await`.
- `||` for defaults treats `0` as falsy. Use `??`. For Number() outputs,
  guard with `Number.isFinite()`.
- Server Components: `safeAuth()` from `@/lib/auth/safe-auth.ts`, never bare
  `auth()` from `@clerk/nextjs/server` — auth() crashes without keys.
- neon-http: `db.transaction()` throws. Use `getNeonSql()` then
  `neonSql.transaction([...statements])`. Audit INSERT before balance UPDATE.
- Refunds: atomic CTE with FOR UPDATE; check `metadata->>'refundedUsageId'`
  for idempotency.
- `||` vs `??` in route params, refund deltas, NaN paths — same trap.
- Generated scripts: verify every `forge.*` call against
  `web/src/lib/scripting/forgeTypes.ts` before claiming the script works.
- Bridge isolation: only `engine/src/bridge/` may import wasm-bindgen /
  web_sys / js_sys. `core/` is pure Rust.
- Dynamic route `[name]` params: validate characters before any DB access,
  not just on POST.

# PR / commit discipline

- Every PR needs `Closes #NNNN` (GitHub issue number, not PF-XXX) AND
  `--milestone "P0|P1|P2|P3: ..."`. Hook blocks `gh pr create` without both.
  Run `python3 .claude/hooks/github_project_sync.py push` first to mint
  the GH issue if the ticket isn't synced yet.
- Every PR needs a changeset unless it carries the `skip changeset` label.
  Run `npx changeset` from the repo root.
- Never merge — Claude opens PRs, the user merges. Run the 5 specialized
  reviewers (architect, security, dx, ux, test) before opening.
- Reply to Sentry/Copilot comments with a commit SHA + action verb
  ("Fixed in abc1234"), or a `#NNNN` follow-up ticket. "Already fixed" or
  bare SHAs without an action verb are blocked by `block-deferred-fixes.sh`.
- No `@mentions` and no self-handoff phrasing in PR comments. The hook
  `block-pr-comment-mistakes.sh` enforces.
- In worktrees: commit after every logical chunk, push before any
  long-running operation. Uncommitted worktree work is permanently lost.

# Reviews

- PASS or FAIL only. No "pass with issues." Any finding at any severity
  blocks. Boy Scout Rule: fix every bug you find, regardless of fault.

# Quality gate (run before any push)

    cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit && npx vitest run

# Tests

- Targeted runs during development:
  `npx vitest run <path>` or `npm run test:changed`. Never the full suite
  unless prepping a PR — it pegs the M2.

EOF

echo "# Rule files (Read on demand for full detail)"
echo ""
for rule in "${RULES[@]}"; do
  rel="${rule#$REPO_ROOT/}"
  case "$(basename "$rule")" in
    bevy-api.md)        hint="Bevy 0.18 API, 0.16->0.18 migration, ECS limits, library APIs" ;;
    entity-snapshot.md) hint="EntityType, EntitySnapshot, history, selection events" ;;
    web-quality.md)     hint="ESLint rules, React patterns, Next.js constraints" ;;
    library-apis.md)    hint="csgrs, noise, terrain, texture pipeline, particles" ;;
    file-map.md)        hint="Engine + web structure, communication pattern" ;;
    gotchas.md)         hint="40+ context-specific gotchas (DB, API, WASM, infra)" ;;
    agent-operations.md) hint="Agent SOPs: testing, committing, PR creation, dispatch" ;;
    *)                  hint="(no summary)" ;;
  esac
  echo "- ${rel} — ${hint}"
done

echo ""
echo "Use Read on the specific file when its topic is in play."

exit 0
