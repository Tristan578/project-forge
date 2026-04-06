---
name: resolve-pr-comments
description: Fetch ALL unresolved review comments on a PR, fix code issues, reply to EVERY comment on its thread, then verify replies are visible. Use after pushing, before declaring PR work complete.
user-invocable: true
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
argument-hint: "<PR_NUMBER>"
---

# Resolve PR Comments

Triage and reply to ALL unresolved Sentry, Copilot, and human review comments on a PR.
Fixes code where needed, replies on each conversation thread, and verifies replies are visible.

**This is the ONLY correct way to handle PR review comments.**

## Step 0: Checkout the PR Branch (MANDATORY)

Before reading ANY files, you MUST be on the PR's head branch. Reading files from the
wrong branch caused a real Sentry bug to be dismissed as a "false positive" (2026-04-04).

```bash
PR=$ARGUMENTS
REPO="Tristan578/project-forge"

# 1. Get the PR's head branch name
PR_BRANCH=$(gh pr view "$PR" --json headRefName --jq .headRefName)

# 2. Get current branch
CURRENT_BRANCH=$(git branch --show-current)

# 3. Switch if needed
if [ "$CURRENT_BRANCH" != "$PR_BRANCH" ]; then
  git stash --include-untracked 2>/dev/null || true
  git checkout "$PR_BRANCH"
  git pull --ff-only origin "$PR_BRANCH" 2>/dev/null || true
fi

# 4. VERIFY — print both and confirm they match
echo "PR branch:      $PR_BRANCH"
echo "Current branch: $(git branch --show-current)"
```

**If these don't match, STOP. Do not proceed to Step 1.**

This is not optional. This is not skippable. Every file you read in Steps 3-4 MUST
come from this branch. If you read a file and it seems shorter or different than the
diff hunk suggests, you are probably on the wrong branch — re-check.

## Step 1: Fetch ALL Review Comments (Paginated)

```bash
PR=$ARGUMENTS
REPO="Tristan578/project-forge"

# MUST paginate — PRs with 30+ comments span multiple pages
gh api "repos/$REPO/pulls/$PR/comments" --paginate \
  --jq '.[] | {id, user: .user.login, path, line: (.line // .original_line), body: (.body | split("\n")[0:3] | join(" | ")), in_reply_to_id}'
```

## Step 2: Identify Unreplied Bot Comments

```python
# Build replied-to set, find unreplied bot comments
import json, subprocess
result = subprocess.run(
    ['gh', 'api', f'repos/{REPO}/pulls/{PR}/comments', '--paginate'],
    capture_output=True, text=True
)
comments = json.loads(result.stdout)
replied_to = {c['in_reply_to_id'] for c in comments if c.get('in_reply_to_id')}
unreplied = [c for c in comments
             if c['user']['login'] in ('sentry[bot]', 'Copilot')
             and c['id'] not in replied_to]
```

**Count must be zero before declaring work complete.**

## Step 3: For Each Unreplied Comment

### 3a: Read the Actual Code (Not the Diff Hunk)

The diff hunk in the comment may be STALE — the code has changed since the comment was posted.
Always read the CURRENT file at the referenced path:

```bash
# Read current code, not the stale diff
Read tool: web/src/lib/game-creation/executors/sceneCreateExecutor.ts
```

### 3b: Determine Resolution Category

| Category | Criteria | Reply Template |
|----------|----------|----------------|
| **Fixed (this commit)** | Code change addresses the issue | `"Fixed in \`<SHA>\`. <what changed>"` |
| **Already fixed (prior commit)** | Issue was fixed before this round | `"Already addressed in \`<SHA>\`. <evidence>"` |
| **By design** | Code is intentionally written this way | `"By design. <specific technical reason with line numbers>"` |
| **False positive** | Reviewer's analysis is incorrect | `"False positive — <specific technical reason>"` |
| **Needs fix** | Issue is valid and code needs changing | Fix the code FIRST, then reply with SHA |

**Every reply MUST contain:** a commit SHA, a line-number reference, or a specific technical reason.
**Never reply with:** "will fix later", "noted", "good point", or any vague acknowledgment.

### 3c: If Code Fix Needed — Fix BEFORE Replying

1. Read the file
2. Apply the fix (Edit tool)
3. **Write a regression test** that would have caught the bug
4. Run: `cd web && npx vitest run <test-file>` (validates both fix and test)
5. Run: `cd web && npx tsc --noEmit` (at minimum)
6. Commit: `git commit -m "fix: <description>"`
7. Push: `git push`
8. THEN reply with the commit SHA

**Regression test is MANDATORY for every "Fixed" or "Needs fix" resolution.**
No code fix ships without a test that prevents the same bug from recurring.
The only exception is when the fix requires a schema migration (tag the issue for follow-up with a test).

### 3d: Post Reply on the Comment Thread

```bash
gh api "repos/$REPO/pulls/$PR/comments/<COMMENT_ID>/replies" \
  -X POST -f body="<reply text>"
```

**CRITICAL:** Use the `/replies` endpoint, not a new top-level comment.
This threads the reply under the original comment in GitHub's UI.

## Step 4: Verify ALL Replies Are Visible

After replying to every comment, verify:

```bash
# Re-fetch and check for any remaining unreplied bot comments
python3 -c "
import json, subprocess
result = subprocess.run(
    ['gh', 'api', 'repos/$REPO/pulls/$PR/comments', '--paginate'],
    capture_output=True, text=True)
comments = json.loads(result.stdout)
replied_to = {c['in_reply_to_id'] for c in comments if c.get('in_reply_to_id')}
unreplied = [c for c in comments
             if c['user']['login'] in ('sentry[bot]', 'Copilot')
             and c['id'] not in replied_to]
print(f'{len(unreplied)} unreplied comments remaining')
for u in unreplied:
    print(f'  {u[\"id\"]} @{u[\"user\"][\"login\"]} {u[\"path\"]}#{u.get(\"line\") or u.get(\"original_line\")}')
"
```

**This MUST print "0 unreplied comments remaining" before you report success.**

If any remain, go back to Step 3 for those comments.

## Step 5: Post Summary as PR Issue Comment

After ALL thread replies are posted, add a single PR-level summary:

```bash
gh pr comment $PR --body "## Review Comment Resolution

All <N> review comments addressed in \`<SHA>\`.

| File | Reviewer | Resolution |
|------|----------|------------|
| path#line | @sentry | Fixed in SHA — description |
| path#line | @Copilot | By design — reason |
..."
```

## HARD RULE: Boy Scout Rule Enforcement (Subagent-Safe)

**This section exists because subagents do NOT inherit settings.json hooks.**
The `block-deferred-fixes.sh` PreToolUse hook only fires for the main agent.
Subagents running this skill MUST self-enforce these rules.

### BANNED reply phrases (will be blocked by hook for main agent, must be self-enforced by subagents)

These phrases are NEVER acceptable in a PR comment reply unless accompanied by
a commit SHA with an action verb ("Fixed in `abc1234`") or a GitHub issue number (#NNNN):

- "will add/fix/address/update/monitor/consider/implement/track/look into"
- "follow-up", "follow up", "next commit/batch/push/pr/sprint"
- "tracked in", "tracking in", "filed for", "defer to", "punt to"
- "pre-existing", "preexisting", "out of scope", "not addressing"
- "good point", "valid point", "valid finding", "fair point"
- "acknowledged", "noted", "makes sense", "agree with"
- "good catch", "nice catch", "looking into"
- "known limitation", "known issue", "low-priority", "low priority"
- "acceptable tradeoff", "maybe later", "minor enough", "not critical"
- "cosmetic", "non-blocking", "nice to have", "future refactor"
- "separate pr", "separate issue", "if this becomes", "todo"

### Before posting ANY reply, self-check:

1. Does my reply contain ANY phrase from the banned list above?
2. If yes: did I include a commit SHA with "Fixed in"/"Addressed in"?
3. If yes: did I include a GitHub issue number (#NNNN)?
4. If NEITHER SHA+action NOR ticket number: **STOP. Fix the code first.**

### Valid reply patterns (the ONLY acceptable forms):

| Pattern | Example |
|---------|---------|
| Fix + SHA | "Fixed in `abc1234`. Added null check at line 42." |
| Already fixed + SHA | "Already addressed in `abc1234`. The guard was added in the previous commit." |
| By design | "By design. The `setTimeout` at line 58 is intentional for debouncing — removing it causes UI flicker." |
| False positive | "False positive — `rateLimitPublicRoute()` is awaited at line 31, the `await` is on the parent `handleRequest` call." |
| Tracked with ticket | "Tracked in #8307. Requires schema migration that can't ship in this PR." |

## Anti-Patterns (What Went Wrong Before)

1. **Only posting a summary comment without thread replies** — User has no way to see which specific comment was addressed without clicking through each thread
2. **Not paginating** — PRs with 30+ comments lose the second page. ALWAYS use `--paginate`
3. **Counting wrong** — There may be multiple rounds of bot comments (Sentry/Copilot re-review on each push). Count ALL bot comments, not just the first batch
4. **Replying to stale code** — The diff hunk in the comment is from when it was posted. Always read the CURRENT file before replying
5. **Assuming prior replies covered everything** — New push = new bot comments. Check AFTER every push
7. **Deferred-fix language without action** — On 2026-04-06, 7 PR comment replies contained phrases like "low-priority follow-up", "known limitation", "out of scope" without code fixes or ticket numbers. The `block-deferred-fixes.sh` hook missed them due to: (a) missing phrases in the pattern list, (b) silent exit-0 on body parse failure, (c) subagents not inheriting settings.json hooks. All three failure modes are now fixed.
6. **Reading files from the wrong branch** — On 2026-04-04, a valid Sentry bug (wrong `cwd` in pre-push hook) was dismissed as "false positive" because the file was read from `main` (123 lines, no changeset section) instead of the PR branch (141 lines, with the buggy changeset check at line 130). The file "seemed fine" because it was a completely different version. Step 0 exists to prevent this. If a file seems shorter or different than the diff hunk suggests, **you are on the wrong branch**.

## When to Use This Skill

- After every `git push` to a PR branch
- Before declaring any PR work complete
- When the user asks about unresolved comments
- As the final step of `/babysit-prs`
