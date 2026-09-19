# Codex CLI support matrix

What of the `.claude/` harness runs under OpenAI Codex CLI in this repository,
what does not, and what stands in for the part that does not. This is the
retain/remove record #9745 asked for.

**Everything Codex-facing is generated.** `tools/agentic-sync/port.mjs` derives it
from `.claude/`; `scripts/check-codex-port.sh` fails a PR when the two differ.
To change an agent, a skill or a hook: edit the source under `.claude/`, run
`node tools/agentic-sync/port.mjs --write`, commit both.

## What was verified, and how

Codex's file formats were **not** inferred from Claude Code's. Each contract
below was read from `openai/codex` at tag `rust-v0.144.1` — the version this was
built against — and the file is named so the claim can be re-checked when the
floor version moves.

| Contract | Source file (`codex-rs/…`) |
|---|---|
| Hooks are read from `<repo>/.codex/hooks.json` and the `[hooks]` table, per config layer; using both in one layer warns | `hooks/src/engine/discovery.rs`, `config/src/loader/mod.rs` |
| Hook events: `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `Stop`. Unknown event keys are ignored, not rejected | `config/src/hook_config.rs` |
| Handler fields `type`, `command`, `commandWindows`, `timeout` (seconds), `statusMessage`; matchers are ignored for `UserPromptSubmit` and `Stop` | `config/src/hook_config.rs` |
| A file edit is reported as tool `apply_patch`; `Edit`/`Write` are matcher aliases only. Shell is `Bash` | `core/src/tools/hook_names.rs` |
| Hook stdin carries `tool_name`, `tool_input`, `cwd`, `hook_event_name`, … — and **no** `file_path`; no `TOOL_INPUT_*` environment variables | `hooks/src/events/pre_tool_use.rs` |
| Exit 2 **with** stderr blocks. `additionalContext`, `systemMessage` and `permissionDecision: "deny"` are honoured. `permissionDecision: "allow"`/`"ask"`, `decision: "approve"`, `continue`, `stopReason`, `suppressOutput` mark the hook run Failed | `hooks/src/events/pre_tool_use.rs` |
| Subagents are `*.toml` under `.codex/agents/`; `name`, `description`, `developer_instructions` are required | `core/src/config/agent_roles.rs` |
| Skills are discovered from `.agents/skills/`; there is no configurable extra directory | `core-skills/src/loader.rs` |
| `[mcp_servers.<name>]` accepts `command`, `args`, `env`, `env_vars`, `default_tools_approval_mode` (`auto` \| `prompt` \| `writes` \| `approve`), `enabled_tools`, `disabled_tools` | `config/src/mcp_types.rs` |
| Under `approval_policy = "never"` an MCP call is auto-approved only when the tool is `approve` or the sandbox has full disk write access | `codex-mcp/src/mcp/mod.rs` |
| Codex does not read a project `.mcp.json` | source search; it appears only as a plugin default |

**Not verified:** any of this running inside a live Codex session. The generator,
the adapter and the gate are tested (`scripts/__tests__/check-codex-port.test.sh`);
a Codex session calling them is not, because hooks need per-hook approval in
`/hooks` and a logged-in session. The first contributor to use this should
confirm the four items under [First-run checklist](#first-run-checklist) and
correct this file.

## Hooks

`.codex/hooks.json` runs each shared `.claude/hooks/*.sh` script through
`.codex/hooks/run-claude-hook.mjs`. The adapter exists because of one line in the
table above: Codex sends an edit as `apply_patch` with the patch text and no
`file_path`, and every Edit/Write hook here begins with "no `file_path` → exit
0". Called directly, all nine would pass on every edit and read as enforcement.
The adapter parses the patch and runs the script once per written file, with the
payload the script expects; if it cannot find a path in a patch it fails rather
than letting the check pass on nothing.

### Ported (31 handlers)

| Claude event | Codex event | Scripts |
|---|---|---|
| `SessionStart` | `SessionStart` | `on-session-start.sh` |
| `UserPromptSubmit` | `UserPromptSubmit` | `on-prompt-submit.sh` |
| `PreToolUse` `Edit\|Write\|Bash` | `PreToolUse` `apply_patch\|Bash` | `inject-lessons-learned.sh` |
| `PreToolUse` `Bash` | `PreToolUse` `Bash` | `pre-push-quality-gate.sh`, `block-main-commits.sh`, `check-pr-metadata.sh`, `check-docs-quality.sh`, `block-deferred-fixes.sh` |
| `PreToolUse` `Edit\|Write` | `PreToolUse` `apply_patch` | `verify-branch.sh`, `check-db-transaction.sh`, `check-sanitization-patterns.sh`, `check-vercel-json.sh` |
| `PostToolUse` `Edit\|Write` | `PostToolUse` `apply_patch` | `auto-lockfile-sync.sh`, `post-edit-lint.sh`, `check-arch.sh`, `check-route-has-test.sh`, `cargo-check-wasm.sh` |
| `PostToolUse` `Bash` | `PostToolUse` `Bash` | `post-commit-clean.sh`, `post-merge-doc-check.sh`, `post-push-resolve-comments.sh` |
| `SubagentStart` / `SubagentStop` | same | `log-agent-start.sh`; `validate-agent-output.sh`, `reject-incomplete-review.sh` |
| `PreCompact` / `PostCompact` | same | `save-critical-context.sh`; `restore-context-hints.sh`, `inject-post-compact.sh` |
| `Stop` | `Stop` | `on-stop.sh`, `lessons-learned-reminder.sh`, `builder-quality-gate.sh`, `review-quality-gate.sh`, `worktree-safety-commit.sh` |

### Not ported, and what covers the gap

| Claude hook | Why Codex cannot run it | Compensating workflow |
|---|---|---|
| `auto-approve-safe-commands.sh` (`PreToolUse` `Bash`) | Its entire output is `permissionDecision: "allow"`, which Codex rejects — the hook run is marked Failed. Codex has no hook-driven approval | Approvals come from `approval_policy` and the sandbox in `.codex/config.toml` |
| `TaskCreated` → `validate-task-metadata.sh` | No such event | The taskboard validates tickets; `on-stop.sh` (ported) re-checks on `Stop` |
| `TaskCompleted` → `validate-task-completion.sh` | No such event | `on-stop.sh` on `Stop` |
| `WorktreeCreate` → `worktree-setup.sh` | No such event | Run `bash .claude/hooks/worktree-setup.sh` by hand after `git worktree add` (stated in `.codex/AGENTS.md`) |
| `SessionEnd` → `on-stop.sh` | Absent from 0.144.1 (present from 0.155) | The same script already runs on `Stop`. Move it into `supportedEvents` in `tools/agentic-sync/port.json` when the floor version rises |
| `ConfigChange` → `detect-settings-drift.sh` | No such event | Codex reviews hook changes itself: a changed hook loses its trusted hash and does not run until re-approved in `/hooks` |
| `InstructionsLoaded`, `CwdChanged` → `inject-dynamic-context.sh` | No such events | The same context is reachable from `.codex/AGENTS.md` |
| `FileChanged` (`.env`) → `env-change-warning.sh` | No such event | None. A `.env` edit made through Codex still passes the `apply_patch` hooks |
| `StopFailure`, `PostToolUseFailure` → `rate-limit-backoff.sh` | No such events | None needed; the script only adds advisory context |

Adding a hook to `.claude/settings.json` on an event that is in neither list
**fails the generator** until someone decides which list it belongs in. That is
deliberate: the first port wired 26 of 39 hooks and nothing said so.

### Limits to know about

- **Per-hook trust.** Codex stores a hash per hook under `[hooks.state]` in the
  user config. A new hook, or one whose command changed, is listed in `/hooks`
  and does not run until approved there. After pulling a change to
  `.codex/hooks.json`, open `/hooks`.
- **Project trust.** An untrusted project's `.codex/` layer is loaded but
  disabled.
- **Linked worktrees read the main checkout's hooks.** Codex replaces a
  worktree's hooks with those of the root checkout, so a hook change is only
  exercised from the main checkout.
- **Start Codex at the repository root.** The POSIX hook commands resolve the
  adapter from `git rev-parse --show-toplevel`. The Windows commands cannot: Codex
  runs hooks through the session shell, which may be `cmd` or PowerShell, and no
  quoting of `$(…)` survives both — so `commandWindows` is a path relative to
  the directory Codex started in. The taskboard MCP entry has the same
  constraint.
- **Subagents do not inherit project hooks under Claude Code.** That gap
  (`.claude/rules/gotchas-ops.md`) was not re-measured for Codex.
- **`jq`.** Most shared scripts parse their input with `jq`. Without it they
  take their "nothing to inspect" branch.

## Subagents

Thirteen generated from `.claude/agents/*.md`, one hand-authored.

- The Markdown body becomes `developer_instructions` **unchanged**. Paths such as
  `.claude/rules/lessons-learned.md` are real paths shared by every assistant;
  rewriting `.claude` to `.codex` is what produced the first port's 143 dead
  references. A short preface maps Claude tool names to Codex's.
- `effort` becomes `model_reasoning_effort`. `model` is dropped — the value is a
  Claude model alias — so each agent inherits the session's model.
- `tools`, `skills`, `mcpServers`, `hooks`, `memory`, `maxTurns`, `isolation`
  name mechanisms Codex does not have and are dropped. **Consequence:** Codex
  has no per-agent tool allow-list, so the read-only reviewers
  (`security-reviewer`, `test-reviewer`, …) are read-only by instruction only,
  not by enforcement as they are under Claude Code.
- `code-architect.toml` is hand-authored: under Claude Code that seat is the
  `feature-dev:code-architect` plugin agent, which has no file in this
  repository to generate from. It is listed under `agents.handAuthored` in
  `tools/agentic-sync/port.json`.

## Skills

The 35 project skills under `.claude/skills/` are mirrored byte-for-byte into
`.agents/skills/`, the only place Codex looks.

- **Why a copy and not a symlink.** Codex follows directory symlinks, and this
  repository already links the other way for third-party skills
  (`.claude/skills/tdd` → `.agents/skills/tdd`). But with `core.symlinks=false`
  — the Git for Windows default — a link checks out as a text file, so the
  skills would not exist on the platform Codex is used on here.
- **Not mirrored:** `game-engine`, `kanban` and `web-accessibility` exist as real
  directories on both sides and have drifted. Which side is canonical is
  undecided, so the generator leaves both alone (`skills.independent`).
- Executable bits follow the source. On a checkout with `core.fileMode=false`,
  `--write` repairs the index entry of any staged mirror whose mode differs.

## MCP servers

Codex does not read `.mcp.json`; servers are restated in `.codex/config.toml`
and `scripts/check-codex-port.sh` fails when the two declare different server
names. `.codex/config.toml` is guarded by a `deny` rule in
`.claude/settings.json`, so it is edited by a person, not by an assistant.

- Secrets are forwarded by **name** with `env_vars`; `${VAR}` interpolation is a
  Claude Code feature and Codex would pass the literal text.
- Every server that holds a credential or reaches the network is
  `default_tools_approval_mode = "prompt"`. The committed profile runs with
  `approval_policy = "never"`; per the last-but-one row of the table above that
  does not auto-approve MCP calls under the workspace-write sandbox, and
  `"prompt"` is stated so a Stripe refund or a Neon branch delete stays
  human-gated if that default ever moves.

## First-run checklist

Unverified until someone does it; correct this file with what you find.

1. Started at the repo root and trusted, does `/hooks` list 31 handlers, and do
   they run once approved?
2. On Windows, which shell runs `commandWindows`, and does the relative path
   resolve?
3. Does an `apply_patch` edit to a file under `web/src/lib/` containing
   `db.transaction(` surface the `check-db-transaction.sh` warning?
4. Does `$review-protocol` resolve, and does `spawn_agent` accept
   `security-reviewer`?
