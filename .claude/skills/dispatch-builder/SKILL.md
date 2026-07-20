---
name: dispatch-builder
description: Orchestrator checklist + canonical prompt template for dispatching builder agents against taskboard tickets. Use before dispatching any builder, when batching tickets for implementation, or when a dispatched builder's output is missing PR metadata (Closes link, milestone, changeset).
---

# Dispatching Builder Agents

The orchestrator (main session) owns ticket lifecycle and dispatch. This skill is the single source of truth for what a builder dispatch must contain. A builder given this template needs zero follow-up questions to produce a mergeable PR.

## Pre-Dispatch Checklist (orchestrator, in order)

1. **Taskboard is up and has data:**
   ```bash
   curl -s http://localhost:3010/api/tickets?projectId=01KMM9ZA6SBZ7RKJZJTZS9VR4R
   ```
   If it fails: `taskboard start --port 3010` (NEVER pass `--db`), wait 2s, re-check. Ticket count of 0 means wrong DB path — stop and investigate, the board is not actually empty.
2. **Batch size:** 5–7 tickets max per builder. More causes rushed anti-patterns. Max 3 concurrent heavy agents on this machine.
3. **Move each ticket to `in_progress`** (orchestrator only — builders MUST NOT move tickets):
   `POST /api/tickets/{id}/move` with `{"status":"in_progress"}`.
4. **Sync tickets to GitHub:** `python3 .claude/hooks/github_project_sync.py push`
   (If GraphQL quota is exhausted, the REST-created issue + `db_set_github_issue_number` fallback applies — see PF-955.)
5. **Find the GitHub issue number** for each ticket: `gh issue list --search "PF-XXX in:title" --limit 1`
6. **Pick the model:** sonnet (`claude-sonnet-4-6`) for mechanical/specced work — the default; opus for genuinely hard cross-layer design or adversarial verification. Never let a subagent default-inherit the session model.
7. **Pick the milestone** (verify list with `gh api repos/Tristan578/project-forge/milestones --jq '.[].title'`):
   - `P0: Production Blockers`, `P1: User Workflow Blockers`
   - `E1: Game Creation E2E`, `E2: Community & Viral Growth`, `E3: Instrumentation & Growth Metrics`, `E4: Onboarding & Activation`, `E5: AI Generation Quality`, `E6: Content Safety & Trust`
   - `S1: Quality & Reliability`, `S2: Accessibility & Compliance`, `S3: Performance & Scale`, `S4: SEO & GEO Foundation`
   - `Post-Launch Vision`
8. **Fill the template below** — one per builder, every placeholder resolved. Never dispatch with an unresolved `<...>`.

## Dispatch Prompt Template

Copy verbatim, resolve every placeholder:

```text
You are implementing the following taskboard tickets. Work in your worktree; the spec in each ticket description is authoritative.

TICKETS (implement in this order):
<for each: PF-XXX — title — GH issue #NNNN — one-line scope>

For each ticket:
1. Read the full ticket description: curl -s http://localhost:3010/api/tickets/<ticket-ulid>
2. Read the referenced spec/files BEFORE editing. Verify spec claims against the actual code — if the spec contradicts the code, STOP on that ticket and report the contradiction instead of guessing.
3. Test-first: write the failing test, then the implementation.
4. Commit after every logical chunk. Include the ticket ID and GH issue number in every commit message.

QUALITY GATE (must pass before creating the PR — run exactly this):
cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit && npx vitest run
(Engine changes additionally: bash .claude/tools/validate-rust.sh check)

CHANGESET: run `npx changeset` from the repo root (or create .changeset/<name>.md) for any user-facing change. Docs/CI-only work: apply the `skip changeset` label to the PR instead.

PR CREATION (one PR for the batch unless tickets are unrelated):
gh pr create --title "<type>: <description>" --milestone "<MILESTONE FROM LIST>" --body "$(cat <<'EOF'
## Summary
- <bullets>

Closes #NNNN (PF-XXX)
<one Closes line per ticket — GitHub issue numbers, never PF numbers>

## Test plan
- <how it was verified>
EOF
)"
Both `Closes #NNNN` AND `--milestone` are REQUIRED — a hook blocks gh pr create without them.

BEFORE COMPLETION (mandatory):
git push -u origin $(git branch --show-current)
Unpushed worktree work is permanently lost.

TASKBOARD RULES: you MUST NOT move tickets or edit ticket metadata. You MAY create tickets for bugs you discover and add subtasks to your assigned tickets. Report each ticket's status back to me in your final message.

REVIEW REPLIES: if you reply to any review/bot comment, it must contain a commit SHA + action verb ("Fixed in <sha>") or a real #NNNN tracking ticket. The banned-phrase list is in .claude/hooks/block-deferred-fixes.sh.

Your final message must list: per-ticket status (done/blocked + why), the PR URL, the branch name, and any bugs ticketed along the way.
```

## After the Builder Returns

1. Verify the branch was pushed and the PR exists with `Closes #NNNN` + milestone.
2. Run the review board (`/review-protocol` — 5 specialized reviewers) before surfacing the PR to the user.
3. Check CI: `gh run list --limit 3`; on failure `gh run view <ID> --log-failed` and fix on the same branch.
4. NEVER merge — the user reviews and merges.
5. Move tickets to the appropriate column based on the builder's report (orchestrator only).
