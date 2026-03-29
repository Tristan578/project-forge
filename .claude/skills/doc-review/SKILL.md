---
name: doc-review
description: Review documentation quality for changed files. Checks code comments, JSDoc, module docs, and README accuracy. Use after completing features, before PRs, or for periodic audits. Outputs PASS/FAIL with action items.
---

# Documentation Review

Review documentation quality for files changed in the current branch.

## Workflow

### Step 1: Identify Changed Files

```bash
# Get files changed vs main
git diff --name-only main...HEAD 2>/dev/null || git diff --name-only HEAD~5
```

### Step 2: Categorize by Domain

For each changed file, determine the review domain:

| File Pattern | Domain | What to Check |
|---|---|---|
| `*.ts`, `*.tsx`, `*.rs` | Code Comments | JSDoc, inline comments, module docs |
| `mcp-server/manifest/commands.json` | MCP Docs | Command descriptions, parameter docs |
| `README.md`, `CLAUDE.md`, `TESTING.md` | Repo Docs | Accuracy, stale references |
| `.claude/rules/*.md` | Rules | File paths exist, patterns current |
| `apps/docs/**` | API Docs | Generated content, internal gating |

### Step 3: Review Each File

For **code files** (`.ts`, `.tsx`, `.rs`):
1. Read the FULL file
2. Check: does every exported function have a JSDoc/doc comment?
3. Check: does the module have a top-level purpose comment?
4. Check: are there stale comments, TODO without tickets, commented-out code?
5. Check: can a junior dev understand each function's purpose in 30 seconds?

For **documentation files** (`.md`):
1. Read the file
2. Grep for numbers (test counts, command counts) and verify them
3. Grep for file paths and verify they exist on disk
4. Grep for URLs and check if they're likely current
5. Check for claims about features — verify the feature exists

For **manifest files** (`commands.json`):
1. Every command must have a non-empty `description`
2. Every parameter must have a `description`
3. Category names must match the `[a-z_]+` pattern
4. `visibility` must be `public` or `internal` on every command

### Step 4: Output

```
## Documentation Review — [branch name]

**Files reviewed:** N
**Verdict:** PASS | FAIL

### Findings (if FAIL)

1. **[file:line]** [Issue]. Fix: [Action].
2. **[file:line]** [Issue]. Fix: [Action].
```

## Quick Mode

When invoked with a specific file path (`/doc-review path/to/file.ts`), review only that file instead of all changed files. This is used by the pre-push hook for targeted validation.
