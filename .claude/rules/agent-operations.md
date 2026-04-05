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
# Valid milestones: "P0: Production Blockers", "P1: User Workflow Blockers",
#                   "P2: Degraded Experience", "P3: Tech Debt"
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
