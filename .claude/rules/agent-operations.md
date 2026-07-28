# Agent Standard Operating Procedures

Every agent MUST follow these procedures. Violations of these rules have caused real bugs, lost work, and wasted sessions.

## MANDATORY: Read Before Acting

Before writing any code, read:
1. **This file** — common operations and anti-pattern avoidance
2. **`.claude/rules/docs-registry.md`** — first-party documentation URLs
3. **`memory/project_lessons_learned.md`** — 29+ anti-patterns from real bugs

## Taskboard Ownership

The orchestrator (main Claude session) owns ALL ticket lifecycle transitions. Subagents MUST NOT call `move_ticket` or the REST `/move` endpoint.

### Permission matrix

| Actor | create_ticket | add subtasks | update description | move_ticket | edit metadata |
|-------|:---:|:---:|:---:|:---:|:---:|
| Orchestrator | yes | yes | yes | yes | yes |
| Builder agents | yes (bugs found) | yes (own ticket) | no | **NO** | **NO** |
| Review agents | yes (findings) | yes | yes (add findings) | **NO** | **NO** |

### Before dispatching any agent (orchestrator steps)

1. Ensure taskboard is running and has data:
   ```bash
   curl -s http://taskboard.localhost:1355/api/board > /dev/null || taskboard start --port 3010 &
   sleep 2  # Wait for startup — NO --db flag, uses OS default
   # Verify board has tickets (0 = wrong DB path)
   curl -s http://taskboard.localhost:1355/api/board | python3 -c "import json,sys; c=len(json.load(sys.stdin).get('tickets',[])); print(f'{c} tickets')"
   ```
2. Move the ticket to `in_progress` (orchestrator does this, not the subagent)
3. Run sync-push: `python3 .claude/hooks/github_project_sync.py push`
4. Find the GitHub issue number: `gh issue list --search "PF-XXX in:title" --limit 1`
5. Include the ticket ID, GH issue number, and a `Closes #NNNN` template in the dispatch prompt

### Subagent rules (builder and review agents)

- Builder agents: create new tickets for bugs discovered during work, add subtasks to the assigned ticket. NOTHING else on tickets.
- Review agents: create tickets for findings, add subtasks, update descriptions with findings. NOTHING else on tickets.
- Include the ticket ID and GH issue number in every commit message.
- Report ticket status back to the orchestrator — never transition it yourself.

### REST API reminder

- Move field is `status`, NOT `column`: `{"status":"in_progress"}`
- Create field is `projectId`, NOT `project`
- Taskboard base URL: `http://taskboard.localhost:1355/api` (fallback: `http://localhost:3010/api`)

## 1. Local Development

### Starting the Dev Server
```bash
cd web && npm run dev
# → http://spawnforge.localhost:1355 (via Portless)
# Auth bypass: http://spawnforge.localhost:1355/dev
```

### In Git Worktrees
URL becomes `http://<worktree-name>.spawnforge.localhost:1355`. Portless auto-detects worktrees.

### Without Portless (fallback)
```bash
cd web && PORTLESS=0 npm run dev
# → http://localhost:3000
```

## 2. Testing (CPU-Aware)

**NEVER run the full vitest suite when you only changed a few files.** M2 has limited CPU — full suites block other agents.

### Targeted Tests (PREFERRED during development)
```bash
# Run tests for specific file
cd web && npx vitest run src/lib/tokens/creditManager.test.ts

# Run tests matching a pattern
cd web && npx vitest run --reporter=verbose -t "creditManager"

# Run only changed files
cd web && npm run test:changed

# Run tests for a directory
cd web && npx vitest run src/stores/slices/
```

### Full Suite (ONLY before PRs or when validator requests it)
```bash
cd web && npm run test                    # Full unit tests
cd web && npx eslint --max-warnings 0 .   # Lint
cd web && npx tsc --noEmit                # TypeScript
```

### E2E Tests
```bash
# Requires WASM build + dev server running
cd web && npm run e2e                      # All E2E
cd web && npx playwright test auth.spec.ts # Single file
cd web && npm run e2e:debug                # Step debugger
```

## 3. Committing (Frequent, Small)

**Commit after every logical chunk.** Rate limits and crashes kill agents — uncommitted work is permanently lost.

### When to Commit
- After each test file written
- After each feature/bug fix implemented
- After each file modified as part of a multi-file change
- Before dispatching another agent
- Before any risky operation (rebase, merge, large refactor)

### Commit Hygiene
```bash
# Stage specific files (never git add -A)
git add web/src/lib/tokens/creditManager.ts web/src/lib/tokens/__tests__/creditManager.test.ts

# Commit with descriptive message
git commit -m "fix: add await to rateLimit call in billing checkout route"
```

### In Worktrees: ALWAYS PUSH
```bash
# After ALL work, push to preserve it
git push -u origin $(git branch --show-current)
```

## 4. PR Creation

### Pre-PR Checklist
```bash
# 1. Run quality gate
cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit && npx vitest run

# 2. Add changeset (if user-facing changes) — run from repo root, not web/
cd "$PROJECT_DIR" && npx changeset
# Or manually: create .changeset/<name>.md with package + semver bump + description

# 3. Sync tickets to GitHub
python3 .claude/hooks/github_project_sync.py push

# 4. Find GitHub issue number
gh issue list --search "PF-XXX in:title" --limit 1

# 5. Create PR with Closes link AND milestone (BOTH REQUIRED)
gh pr create --title "fix: description" --milestone "P1: User Workflow Blockers" --body "$(cat <<'EOF'
## Summary
- bullet points

Closes #NNNN (PF-XXX)

## Test plan
- [ ] test steps
EOF
)"
# Valid milestones (verify with: gh api repos/Tristan578/project-forge/milestones --jq '.[].title'):
#   "P0: Production Blockers", "P1: User Workflow Blockers"
#   "E1: Game Creation E2E", "E2: Community & Viral Growth", "E3: Instrumentation & Growth Metrics",
#   "E4: Onboarding & Activation", "E5: AI Generation Quality", "E6: Content Safety & Trust"
#   "S1: Quality & Reliability", "S2: Accessibility & Compliance",
#   "S3: Performance & Scale", "S4: SEO & GEO Foundation"
#   "Post-Launch Vision"
# Pick by content: P0/P1 for blockers, E* for epics, S* for sustaining categories.
```

### After PR Creation
- Check for Sentry comments: use `sentry:sentry-code-review` skill
- Check CI status: `gh run list --limit 3`
- If CI fails: `gh run view <ID> --log-failed`

## 5. PR Review (Sentry + GitHub)

### Check for Sentry Comments
```bash
# Use Sentry MCP
# search_issues with project spawnforge-ai, query matching the PR's changed files
```

### Check for GitHub Review Comments
```bash
gh pr view <N> --comments
gh api repos/Tristan578/project-forge/pulls/<N>/comments
```

### Fix CI Failures
```bash
gh run view <ID> --log-failed   # Get failure details
# Fix on the same branch, push, CI re-runs automatically
```

## 6. Investigating Production Issues

### Sentry (org: tristan-nolan, project: spawnforge-ai)
Use Sentry MCP tools:
- `search_issues` — find errors by query
- `get_issue_details` — deep dive
- `search_events` — raw event search
- `get_trace_details` — distributed tracing

### Vercel Logs
```bash
vercel logs <deployment-url> --since 1h
# Or use Vercel MCP: get_runtime_logs
```

### Stripe Webhooks
```bash
stripe logs tail                    # Live API logs
stripe events list --limit 5       # Recent events
stripe listen --forward-to http://spawnforge.localhost:1355/api/webhooks/stripe  # Local testing
```

## 7. Anti-Pattern Prevention

These are the top anti-patterns from `memory/project_lessons_learned.md`. Check EVERY time.

### Before Editing panelRegistry.ts
Read 10 lines before AND after the insertion point. Run `npx vitest run src/lib/workspace/__tests__/panelRegistry.test.ts` after. (#1 bug — 21 instances)

### Before Any rateLimit Call
Verify `await` is present. `rateLimitPublicRoute()` is async. (#2 bug)

### Before Using `||` for Defaults
Is the value ever legitimately `0`? Use `??`. Is the value from `Number()`? Check for NaN: `Number.isFinite()`. (#3 bug)

### Before Creating a New Module
Grep for the call sites that SHOULD use it. The module is not done until callers are wired. (#23 bug)

### Before Any `forge.*` API Call in Generated Scripts
Check `web/src/lib/scripting/forgeTypes.ts` — verify method exists, correct namespace, property vs function. (#28 bug)

### Before PR Body
Use `Closes #NNNN` (GitHub issue number), NOT `Closes PF-XXX`. Run sync-push first. (#26 bug)

## 8. Browser Verification

Use Playwright MCP to verify UI changes:
```
browser_navigate → http://spawnforge.localhost:1355/dev
browser_snapshot → check page structure
browser_console_messages → check for errors
browser_take_screenshot → visual verification
```

## 9. Database Operations

```bash
cd web && npm run db:generate    # Generate migration from schema changes
cd web && npm run db:migrate     # Apply migrations
cd web && npm run db:push        # Push schema directly (dev only)
cd web && npm run db:studio      # Visual DB browser
```

## 10. Bundle Analysis

```bash
cd web && npm run analyze            # Opens bundle visualization
cd web && npm run check:bundle-size  # Automated size enforcement
```

## 11. Long-Session Rule Persistence (PostCompact hook)

Claude Code only loads `CLAUDE.md` and `.claude/CLAUDE.md` on `SessionStart`. After auto-compaction (long sessions, typically >4hr on the main agent), those rules are dropped. The `.claude/hooks/inject-post-compact.sh` hook fires on `PostCompact` and re-injects a digest of `.claude/rules/` so the agent does not drift into deprecated patterns mid-session.

- Triggered by: `PostCompact` event in `.claude/settings.json` (timeout 5s, runs ~30ms in practice)
- Output: a fixed digest of the highest-frequency anti-patterns + a pointer table listing every file under `.claude/rules/` with a one-line summary. The agent is told to `Read` the specific rule file when its topic is in play. The full file contents are NOT emitted.
- Why a digest, not a dump: hook stdout is capped at 10,000 chars by Claude Code (truncated silently). The full rule set is ~47KB, so a raw `cat` blew the budget and the tail (often the most critical gotchas) was dropped. The digest stays ~3.5KB; combined with `restore-context-hints.sh`, total well under 5KB.
- Runs alongside `restore-context-hints.sh`, which restores per-session working state from the `PreCompact` snapshot at `/tmp/spawnforge-context-snapshot.txt`

To test the hook manually: `bash .claude/hooks/inject-post-compact.sh`. To see the wall-clock cost: `time bash .claude/hooks/inject-post-compact.sh > /dev/null`. To verify the size budget: `bash .claude/hooks/inject-post-compact.sh | wc -c` (should be well under 10000).

When you add a new file under `.claude/rules/`, the glob picks it up automatically — but the pointer-table summary in the hook is a hardcoded `case` block. Add a one-line summary for the new file there so the agent knows what topic the file covers.

## 12. Testing Hooks (`.claude/hooks/__tests__/`)

Hooks with non-trivial logic (verdict gates, deferred-fix detection, metadata
checks) get a co-located bash test next to the hook under `.claude/hooks/__tests__/`.
A hook silently exiting the wrong code is a hard-to-spot failure — a SubagentStop
gate that loops, or a PreToolUse gate that blocks valid work — so these are tested
like any other code, TEST-FIRST.

### Running hook tests

```bash
# A single hook's suite
bash .claude/hooks/__tests__/reject-incomplete-review.test.sh

# All hook test suites
for t in .claude/hooks/__tests__/*.test.sh; do echo "== $t =="; bash "$t" || break; done

# Lint the review-loop hooks this gate owns — zero findings required, and the CI
# `hook-tests` job (.github/workflows/ci.yml) runs exactly this. Newly added or
# edited hooks MUST be shellcheck-clean.
shellcheck \
  .claude/hooks/reject-incomplete-review.sh \
  .claude/hooks/review-quality-gate.sh \
  .claude/hooks/__tests__/reject-incomplete-review.test.sh \
  .claude/hooks/__tests__/review-quality-gate.test.sh

# Linting the WHOLE tree still surfaces ~10 pre-existing findings across 8 older
# hooks (tracked in #8676). Scope shellcheck to the files you touched until that
# cleanup lands rather than treating the legacy debt as a regression:
#   shellcheck .claude/hooks/*.sh .claude/hooks/__tests__/*.test.sh
```

Each suite is a self-contained bash script that exits non-zero if any case fails
(no bats dependency — bats is not installed). See
`.claude/hooks/__tests__/reject-incomplete-review.test.sh` as the canonical
pattern. CI runs every `*.test.sh` under `.claude/hooks/__tests__/` via the
path-gated `hook-tests` job whenever `.claude/hooks/**` changes, so a regression
in a hook's exit-code contract fails the PR instead of silently shipping.

### Writing a hook test

- Drive the hook through its real contract: build the JSON payload (Edit/Write
  hooks read `TOOL_INPUT_*` env vars; Stop/SubagentStop/Bash hooks read stdin
  JSON) with `jq -nc --arg ...`, pipe it to `bash "$HOOK"`, and assert on `$?`.
  Exit 0 = allow/continue, exit 2 = block — those two codes ARE the behavior, so
  assert on them directly.
- Cover the boundary, the fail-safe, and the "looks-like-but-isn't" cases, not
  just the happy path — e.g. exact length thresholds, malformed/non-JSON stdin
  (must fail safe, never propagate a `jq` error code through `set -e`), and
  word-boundary near-misses (`PASSED` is not the `PASS` verdict).
- Guard host assumptions at the top (`command -v jq` etc.) so a missing tool
  reports clearly instead of every case failing.
- A hook test that needs to verify negative cases against a file the hook reads
  (not stdin/env args) needs a fixture seam: an env override defaulting to the
  real file, e.g. `FOO="${FOO_FILE:-$HERE/../../real.json}"`. NEVER set the
  override in CI — it must be paired with an in-suite self-defense assertion
  that greps both `.github/workflows/` and (if present) `.github/actions/` for
  the seam name(s) AND the self-re-exec seam literals (`--selftest-child`,
  `BASH_ENV`), comment-stripped (a full-comment mention doesn't count as
  wired), fail-closed on a missing/unreadable dir AND on grep scan errors
  (exit >= 2), plus a runtime assertion — hoisted OUT of any recursion-guarded
  block so it evaluates on every non-child invocation, not only a top-level
  one — that fails if the override is ever set AT ALL, unconditionally. Do
  NOT scope this to `CI` being set: `CI` detection is itself
  attacker/misconfiguration-controlled (a bare `CI=` empty assignment in a
  workflow env block would silently neuter a CI-scoped version of this
  check), so the runtime assertion must fire regardless of `CI`. It catches
  wiring no static grep could see, e.g. a composite action exporting the
  override via `$GITHUB_ENV`. Consume the seam itself via self-re-exec:
  re-invoke the suite (`bash "${BASH_SOURCE[0]}" --selftest-child`) with the
  override pointed at a jq-mutated bad fixture, gating the negative-coverage
  block on an **argv flag** (`[ "${1:-}" != "--selftest-child" ]`), never an
  env var — an env-var recursion guard (e.g. a bare `_SELFTEST=1`) is
  spoofable via `$GITHUB_ENV` and would let CI-side tampering neuter the
  negative-path self-tests. An argv flag RAISES the cost of that tampering;
  it does NOT close the vector outright — it isn't itself settable via
  `$GITHUB_ENV`, but a workflow env block wiring `BASH_ENV` is sourced by
  non-interactive bash before the suite body runs, and that sourced script
  could `set -- --selftest-child` to rewrite positional parameters. This is
  a strictly more conspicuous, `BASH_ENV`-class arbitrary-code-exec
  primitive, and it is itself caught by the widened static scan above (same
  register as the `check-ci-success.sh` anti-tamper language in
  `gotchas.md`: raises cost, doesn't claim to be airtight).

  The argv gate also leaves a hole in the reverse direction: a top-level
  `bash <suite> --selftest-child` satisfies the flag with no parent,
  silently skipping the whole negative-coverage block and exiting 0. So
  the runtime assertion needs FOUR branches, not three — the flagged arm
  must additionally prove parentage (the spawner helper is the only
  legitimate source of the flag and always sets the override, so a
  flagged invocation WITHOUT the override is an orphan), and an orphan
  must FAIL. Give that arm its own regression probe: spawn a bare flagged
  child with the override unset and assert the orphan FAIL.

  Assert on the child's exit code AND that its captured output contains
  the specific FAIL
  message the hook emits, anchored to the FAIL line specifically (e.g. grep
  `FAIL <substr>`, not a bare substring) — both `ok` and `FAIL` lines can
  print the same descriptive text, so an unanchored grep is vacuous (a bare
  nonzero exit doesn't prove *which* check failed, and an unanchored match
  can pass against the wrong line). See `settings-permissions.test.sh`'s
  `SETTINGS_PERMISSIONS_FILE`/`--selftest-child` seam for the canonical
  example (round 3-7 hardening, PF-853) — the runtime assertion there also
  covers the legacy `SETTINGS_PERMISSIONS_SELFTEST` env-var name so a
  scan/assertion widened for one seam variant doesn't miss the other. Same
  scan pattern as the `$NPM_AUDIT_CMD`/`$GHAW_COMPILE_CMD`/`$NATIVE_BINDINGS_*`
  seams in scripts land.
