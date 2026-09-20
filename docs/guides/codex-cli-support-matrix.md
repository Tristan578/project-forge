# Codex CLI support matrix

What of the `.claude/` harness runs under OpenAI Codex CLI in this repository,
what does not, and what stands in for the part that does not. This is the
retain/remove record #9745 asked for.

**Most of what Codex reads is generated.** `tools/agentic-sync/port.mjs` derives
the project skills under `.agents/skills/`, thirteen of the fourteen
`.codex/agents/*.toml`, `.codex/hooks.json` and `.codex/hook-conditions.json`
from `.claude/`; `scripts/check-codex-port.sh` fails a PR when the two differ.
Four Codex-facing files are **hand-written** and reviewed like any other code:
`.codex/config.toml`, `.codex/AGENTS.md`, `.codex/agents/code-architect.toml`
and the hook adapter `.codex/hooks/run-claude-hook.mjs`. To change an agent,
a skill or a hook: edit the source under `.claude/`, **`git add` any file that
is new** (only files git tracks are mirrored, so `--write` reports a new one as
`untracked:` and exits 1 until it is staged), run
`node tools/agentic-sync/port.mjs --write`, commit both.

## Status: wired and tested outside Codex; not yet run inside it

The generator, the adapter and the gate are tested
(`scripts/__tests__/check-codex-port.test.sh`), including the generated hook
command executed end to end. **No part of this has been observed in a live
Codex session**, because hooks need a logged-in session and a per-hook approval
in `/hooks`. Until someone completes the [first-run checklist](#first-run-checklist)
and corrects this file, read "ported" below as "wired to the verified contract",
not "seen working". `.codex/AGENTS.md` keeps the manual fallback for that reason —
but note where Codex gets its instructions: it loads `AGENTS.md` only from the
repository root down to the directory it started in (`core/src/agents_md.rs`), so
`.codex/AGENTS.md` is **not loaded automatically**. The root `AGENTS.md` is, and
its first section tells a Codex session to read `.codex/AGENTS.md`. Every
"instruction only" control below reaches the model through that one hop.

## What was verified, and how

Codex's file formats were **not** inferred from Claude Code's. Each contract
below was read from `openai/codex` at tag `rust-v0.144.1` — the version this was
built against — and the file is named so the claim can be re-checked when the
supported version moves. Nothing is claimed about any other version.

| Contract | Source file (`codex-rs/…`) |
|---|---|
| Hooks are read from `<repo>/.codex/hooks.json` and the `[hooks]` table, per config layer; using both in one layer warns | `hooks/src/engine/discovery.rs`, `config/src/loader/mod.rs` |
| Hook events: `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `Stop`. Unknown event keys are ignored, not rejected | `config/src/hook_config.rs` |
| Handler fields `type`, `command`, `commandWindows`, `timeout` (seconds), `statusMessage`, `async`. A handler marked `async` is **skipped** ("async hooks are not supported yet"). Matchers are ignored for `UserPromptSubmit` and `Stop` | `config/src/hook_config.rs`, `hooks/src/engine/discovery.rs` |
| A file edit is reported as tool `apply_patch`; `Edit`/`Write` are matcher aliases only. Shell is `Bash` | `core/src/tools/hook_names.rs` |
| **There is a second edit channel.** The exec tool reports a shell command to `PreToolUse` as tool `Bash` with the command text, and only afterwards checks whether it is a patch and applies it as one. It intercepts exactly two forms, each only as the sole top-level statement: `apply_patch <<'EOF' … EOF` and `cd <path> && apply_patch <<'EOF' … EOF` (also `applypatch`). The query puts **no constraint on the heredoc delimiter** — `'END-PATCH'`, `'1EOF'`, `\EOF` and an unquoted word are all intercepted; hunk paths resolve against `cwd`, moved by that `cd` **and by the exec tool's `workdir` argument, which the hook payload does not carry**. The `PostToolUse` call for such an edit carries no command at all | `core/src/tools/handlers/unified_exec/exec_command.rs`, `apply-patch/src/invocation.rs` |
| Hook stdin carries `tool_name`, `tool_input`, `cwd`, `hook_event_name`, … — and **no** `file_path`; no `TOOL_INPUT_*` environment variables | `hooks/src/events/pre_tool_use.rs` |
| **Only exit 2 with non-empty stderr blocks.** Any other non-zero exit marks the run Failed and the action proceeds | `hooks/src/events/pre_tool_use.rs` |
| Plain (non-JSON) stdout is dropped. Each event accepts its own `deny_unknown_fields` JSON shape: `additionalContext` on `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStart`; top-level `decision`/`reason` on `UserPromptSubmit`, `PostToolUse`, `SubagentStop`, `Stop`; **`PreCompact` and `PostCompact` accept neither** | `hooks/src/schema.rs`, `hooks/src/events/compact.rs` |
| `permissionDecision: "allow"`/`"ask"` and `decision: "approve"` mark a `PreToolUse` run Failed. `updatedInput` is honoured only alongside a deny; the adapter never forwards it (no script here uses it) | `hooks/src/events/pre_tool_use.rs`, `hooks/src/engine/output_parser.rs` |
| Patch file headers (`*** Add\|Update\|Delete File: `) are matched on the line after Rust `trim()` — which strips the Unicode White_Space property, U+0085 included, unlike JavaScript's — **except inside an Update hunk, where headers and `*** Move to: ` are matched after `trim_end()` only**, so an indented header there is a context line (`keeps_indented_update_markers_as_context_lines`). `Move to` counts only directly under its Update header, before any chunk, and once. The path is everything after the marker, unvalidated; lines split on `\n` alone, and a trailing `\r` is stripped from each line **twice** (once by `lines()`, again by `push_delta` — so a line that is exactly `\r\r` is an empty line), except the last, which is stripped once. The last line ends the patch if it *trims* to `*** End Patch`, in any state. A patch the parser rejects is not applied | `apply-patch/src/parser.rs`, `apply-patch/src/streaming_parser.rs` |
| What the exec tool does not intercept runs in a real shell, where `apply_patch` and `applypatch` are real executables: a directory holding them is prepended to `PATH` | `arg0/src/lib.rs` |
| Project instructions are `AGENTS.md` files collected from the project root (nearest `.git`) down to the cwd. **`<repo>/.codex/AGENTS.md` is not on that path and is not loaded** | `core/src/agents_md.rs` |
| Subagents are `*.toml` under `.codex/agents/`; `name`, `description`, `developer_instructions` are required | `core/src/config/agent_roles.rs` |
| Skills are discovered from `.agents/skills/` (and the project layer's `.codex/skills/`); there is no configurable extra directory | `core-skills/src/loader.rs` |
| `[mcp_servers.<name>]` accepts `command`, `args`, `env`, `env_vars`, `default_tools_approval_mode` (`auto` \| `prompt` \| `writes` \| `approve`), `enabled_tools`, `disabled_tools` | `config/src/mcp_types.rs` |
| Under `approval_policy = "never"` an MCP call is auto-approved only when the tool is `approve` or the sandbox has full disk write access | `codex-mcp/src/mcp/mod.rs` |
| Codex does not read a project `.mcp.json` | source search; it appears only as a plugin default |

## Hooks

`.codex/hooks.json` runs each shared `.claude/hooks/*.sh` script through
`.codex/hooks/run-claude-hook.mjs`. The adapter exists because rows of the table
above fail *silently* if ignored:

- **No `file_path`.** Every Edit/Write hook here begins with "no `file_path` →
  exit 0". Called directly, all nine would pass on every edit and read as
  enforcement. The adapter parses the patch with a **line-for-line port of
  Codex's own parser** (three approximations each hid a file or showed a hook the
  wrong path) and runs the script once per **touched** path: added, updated and
  deleted files, and both ends of a move, each normalised — an absolute
  `…/web/src/./lib/x.ts` is shown as `…/web/src/lib/x.ts`, like a relative one.
  **A patch the port cannot parse is blocked**, naming the parse error. Codex
  should reject such a patch too; if it does not, the port has diverged, and a
  block says so where the fallback that used to be here (show whatever looks
  like a header) turned every such divergence into a silent exit 0 with the
  added lines and the Move destination missing.
- **Only exit 2 blocks.** If the adapter itself cannot do its job on
  `PreToolUse` (unreadable or empty payload, a patch it cannot parse or that
  touches no file, a shell command whose `command` is not a string, script or
  bash missing, out of time) it exits 2 with the reason. Exit 1 there would let
  the action through. A *script* that crashes on one path is a reported failure,
  as under Claude Code — but the remaining paths are still checked and any block
  among them wins, because under Claude Code each file is its own invocation.
- **One invocation, many files.** A `timeout` in `.claude/settings.json` bounds
  one file's check; one Codex hook invocation covers a whole patch. `hooks.json`
  therefore declares per-file × 10 (capped at 600 s) for `apply_patch` hooks and
  per-file + 5 s for the rest, and hands the adapter both numbers (a hook with
  no `timeout` of its own gets 10 s per file rather than no bound). Each script
  run keeps its own per-file bound, and if the budget runs out with paths still
  unchecked the adapter blocks on `PreToolUse` — before Codex's own timeout
  fires, which would only mark the run Failed and let the edit through. A very
  large patch is told to split itself.
- **Plain text is dropped.** Most advisory hooks here print a warning as text.
  The adapter wraps it as `additionalContext` on the events that accept it. On
  the four that accept no context (`Stop`, `SubagentStop`, `PreCompact`,
  `PostCompact`) it becomes a `systemMessage` — shown to the person, not the
  model, which is the most those events allow. A JSON block is translated into
  the shape each event takes, and when a script blocks (exit 2) with its reason
  on stdout rather than stderr — `reject-incomplete-review.sh` does — that
  stdout is forwarded as the reason.
- **Two edit channels.** Because of the contract rows above, the four
  `PreToolUse` edit hooks are wired for `Bash` as well as `apply_patch`, in mode
  `edit`. The threat model is the exec tool's real-shell path: whatever Codex
  does not intercept is run by a shell in which `apply_patch` is a real
  executable, from whatever directory that shell has reached, after whatever
  expansion it has done. Five attempts to READ the shell text each failed open
  somewhere — an identifier-only heredoc delimiter, a line continuation, an
  earlier `<<` hiding a `cd`, `env -C`, a decoy heredoc before the real one, an
  unquoted delimiter letting `$(…)` rewrite a path. So **the shell is not read.**
  A shell command is *patch-bearing* if any line of it looks like a file header
  (the widest rule Codex uses, with no regex on the path), and a patch-bearing
  command has exactly two outcomes:
  - **accepted** — the WHOLE command, first byte to last, is
    `apply_patch <<'D'` … `D` or `cd <literal path> && apply_patch <<'D'` … `D`
    (or `applypatch`): spaces and tabs only as separators — plus a
    backslash-newline continuation, which may join the first line (outside the
    `cd` target) exactly as the shell joins it — the delimiter
    **quoted** so the shell expands nothing in the body, a literal `cd` target
    (quoted, or a bare word of `[A-Za-z0-9_./-]`) that is not empty and does not
    start with `-`, nothing after the closing delimiter, and a body that the
    port of Codex's own parser accepts. Then the base directory and every path
    are known, and each path is shown to the hook;
  - **refused** — everything else, without being parsed, so nothing in it can
    mislead. The hook blocks with a message giving the ways out.

  A command with no header line is an ordinary command: a patch that names no
  file edits nothing, so a `grep` for the envelope markers is left alone. That
  also covers a patch whose text is not in the command (`apply_patch < fix.patch`)
  or is assembled by the shell — a shell writing files, which no Edit/Write hook
  sees under Claude Code either. An `if` condition never gates a file hook on
  this channel. The cost in time is one short-lived `node` start per edit hook
  per shell command; the cost in false blocks is under "Limits to know about".

It also applies the `if` conditions from `.claude/settings.json`, which Codex has
no key for, from the generated `.codex/hook-conditions.json`: six hooks carry
one, over four distinct patterns (`Bash(git push *)` three times,
`Bash(git commit *)`, `Bash(gh pr create *)`, `Bash(gh api *)`). Matching is deliberately generous — the
words before the first `*` must appear in the command in that order, as words,
with anything between them (`git -C . commit`, `git  commit`, `git -c k=v commit`
and a line continuation between the words all match `Bash(git commit *)`) —
because running a script that then finds nothing to do is harmless and not
running one that would have blocked is not.

### Ported (29 handlers)

| Claude event | Codex event | Scripts |
|---|---|---|
| `SessionStart` | `SessionStart` | `on-session-start.sh` |
| `UserPromptSubmit` | `UserPromptSubmit` | `on-prompt-submit.sh` |
| `PreToolUse` `Edit\|Write\|Bash` | `PreToolUse` `apply_patch\|Bash` | `inject-lessons-learned.sh` |
| `PreToolUse` `Bash` | `PreToolUse` `Bash` | `pre-push-quality-gate.sh`, `block-main-commits.sh`, `check-pr-metadata.sh`, `check-docs-quality.sh`, `block-deferred-fixes.sh` (each with its `if` condition). `block-deferred-fixes.sh` loses its `statusMessage` ("Checking for Boy Scout Rule violations") — see the note under this table |
| `PreToolUse` `Edit\|Write` | `PreToolUse` `apply_patch\|Bash`, mode `edit` (see "Two edit channels") | `verify-branch.sh`, `check-db-transaction.sh`, `check-sanitization-patterns.sh`, `check-vercel-json.sh`. Their `statusMessage` is dropped: matched for every shell command, a line like "Checking sanitization patterns" would be false |
| `PostToolUse` `Edit\|Write` | `PostToolUse` `apply_patch` | `auto-lockfile-sync.sh`, `post-edit-lint.sh`, `check-arch.sh`, `check-route-has-test.sh`, `cargo-check-wasm.sh` |
| `PostToolUse` `Bash` | `PostToolUse` `Bash` | `post-commit-clean.sh`, `post-merge-doc-check.sh`, `post-push-resolve-comments.sh` (`if: Bash(git push *)`; `async` dropped, so it runs synchronously for up to 30 s after a push — and, its `statusMessage` being dropped too, **with no status line explaining the wait**; see the note under this table) |
| `SubagentStart` / `SubagentStop` | same | `log-agent-start.sh`; `validate-agent-output.sh`, `reject-incomplete-review.sh` |
| `PreCompact` | `PreCompact` | `save-critical-context.sh` — it writes a snapshot file; that side effect works. Anything it prints reaches the person as a `systemMessage`, never the model |
| `Stop` | `Stop` | `on-stop.sh`, `lessons-learned-reminder.sh`, `builder-quality-gate.sh`, `review-quality-gate.sh`, `worktree-safety-commit.sh`. `Stop` and `SubagentStop` accept no context: the reminders `lessons-learned-reminder.sh`, `builder-quality-gate.sh` and (on `SubagentStop`) `validate-agent-output.sh` print are shown to the **person** as a `systemMessage`; under Claude Code they reach the model. A block (exit 2) works on both |

**No ported hook shows a status line.** `.claude/settings.json` sets a
`statusMessage` on four handlers. One belongs to `auto-approve-safe-commands.sh`,
which is not ported. The other three are dropped by two rules in the generator,
for one reason: Codex shows the line whenever the handler is *matched*, and it
has no `if`, so these handlers are matched for every shell command while acting
on almost none —

- an edit-only hook is matched for `Bash` to see a carried patch
  ("Checking sanitization patterns" would show on an `ls`);
- a handler whose group carries an `if` has that condition applied inside the
  adapter ("Checking for Boy Scout Rule violations" and "Checking for unreplied
  review comments" would show on every command, where Claude Code shows them on
  `gh api` and `git push` alone).

The trade-off is silence where Claude Code explains itself: after a `git push`,
`post-push-resolve-comments.sh` can hold the turn for up to 30 s with nothing on
screen saying why. A line that is false on every other command was judged worse
than none; the contract row above lists `statusMessage` because Codex supports
the field, not because this port uses it.

### Not ported, and what covers the gap

| Claude mechanism | Why Codex cannot run it | Compensating workflow |
|---|---|---|
| `PostCompact` → `restore-context-hints.sh`, `inject-post-compact.sh` | Both exist only to put context back in front of the model. Codex's `PostCompact` output accepts no context field and drops plain text, so they would run and change nothing | **Instruction only:** the root `AGENTS.md` (which Codex loads; `.codex/AGENTS.md` it does not) tells the agent to re-read `.claude/rules/lessons-learned.md` after a compaction |
| `auto-approve-safe-commands.sh` (`PreToolUse` `Bash`) | Its entire output is `permissionDecision: "allow"`, which marks the run Failed. Codex has no hook-driven approval | Approvals come from `approval_policy` and the sandbox in `.codex/config.toml` |
| `permissions.deny` (Edit/Write on `.claude/settings.json` and `.codex/config.toml`) | A Claude Code permission rule, not a hook; Codex has no equivalent this repository configures | **None.** Under the committed profile (`approval_policy = "never"`, workspace writes allowed) nothing in this repository stops a Codex session editing either file. Whether Codex's sandbox protects `.codex/` was not checked. Review any change to those two files |
| `TaskCreated` → `validate-task-metadata.sh` | No such event | The taskboard validates tickets; `on-stop.sh` (ported) re-checks on `Stop` |
| `TaskCompleted` → `validate-task-completion.sh` | No such event | `on-stop.sh` on `Stop` |
| `WorktreeCreate` → `worktree-setup.sh` | No such event | By hand after `git worktree add`, **with its payload**: the script reads `{"worktree_path": …}` from stdin and does nothing when run bare. `.codex/AGENTS.md` has the exact command |
| `SessionEnd` → `on-stop.sh` | Not an event 0.144.1 accepts; an unknown event key is silently ignored | The same script runs on `Stop` |
| `ConfigChange` → `detect-settings-drift.sh` | No such event | Codex reviews hook changes itself: a changed hook loses its trusted hash and does not run until re-approved in `/hooks` |
| `InstructionsLoaded`, `CwdChanged` → `inject-dynamic-context.sh` | No such events | The same context is in `.codex/AGENTS.md`, which the root `AGENTS.md` tells a Codex session to read (Codex does not load it by itself) |
| `FileChanged` (`.env`) → `env-change-warning.sh` | No such event | None. A `.env` edit made through Codex still passes the `apply_patch` hooks |
| `StopFailure`, `PostToolUseFailure` → `rate-limit-backoff.sh` | No such events | None needed; the script only adds advisory context |

Adding a hook to `.claude/settings.json` on an event in neither list — or with a
group or handler key the generator has not classified — **fails the generator**
until someone decides where it belongs. That is deliberate: the first port wired
26 of 39 hooks and nothing said so.

### Limits to know about

- **A patch sent through the shell with a `workdir` cannot be located.** The
  exec tool's `workdir` argument moves the directory the hunk paths resolve
  against, and the hook payload carries only the command. The adapter fails
  closed where that is detectable: a carried patch that UPDATES or DELETES a
  file which does not exist where the paths resolve is blocked, with a message
  to use the patch tool or root-relative paths. A carried patch that only ADDS
  files under an unseen `workdir` is checked against the wrong path, and nothing
  can tell. Item 7 of the checklist.
- **Any shell command that contains a patch, other than the accepted form, is
  refused.** The rule above cannot tell a command that APPLIES a patch from one
  that only WRITES text containing one, so a heredoc that writes a patch file, a
  test fixture, or a multi-line commit message quoting a whole patch is blocked
  on `PreToolUse` — whenever a line of it starts with `*** Add File: `,
  `*** Update File: ` or `*** Delete File: `. The message names the ways out:
  create the file with the patch tool, or pass the text from a file
  (`git commit -F <file>`) so the patch is not inside a shell command. **Weigh
  it knowing what it buys today:** the four hooks on this path
  (`verify-branch.sh`, `check-db-transaction.sh`, `check-sanitization-patterns.sh`,
  `check-vercel-json.sh`) only ever advise — none exits 2 — so the refusal
  currently protects a correctly-aimed *warning*, not a block. It is sized for
  the blocking check this document tells authors to put on this path. Item 8 of
  the checklist asks whether that is the right trade. One refused command is
  also refused **once per edit hook** — four today — because each handler is its
  own process and each must block on its own; the text is identical from all of
  them and names the adapter rather than the check. How Codex presents several
  blocking hooks to the model (the first, or all of them) was not verified.
- **`PostToolUse` cannot see a patch sent through the shell.** For the second
  edit channel the `PostToolUse` payload carries no command, so the five
  post-edit hooks (`post-edit-lint`, `check-arch`, `check-route-has-test`,
  `cargo-check-wasm`, `auto-lockfile-sync`) do not run for an edit made as
  `apply_patch <<EOF` in a shell command. The `PreToolUse` hooks do. A new
  *blocking* check on file edits belongs on `PreToolUse` for that reason.

- **Started anywhere but the repository root on Windows, every hook silently
  does nothing.** The POSIX commands resolve the adapter from
  `git rev-parse --show-toplevel`. The Windows commands cannot: Codex runs hooks
  through the session shell, which may be `cmd` or PowerShell, and no quoting of
  `$(…)` survives both — so `commandWindows` is relative to the directory Codex
  started in. From any other directory `node` cannot find the adapter and exits
  1, which Codex reports as Failed **and proceeds**. Blocking hooks then do not
  block. Start Codex at the root.
- **`[features] shell_tool = false` is set in the committed `.codex/config.toml`.**
  Thirteen of the 29 handlers match `Bash` — nine shell hooks, including the
  four policy hooks (`block-main-commits`, `check-pr-metadata`,
  `pre-push-quality-gate`, `block-deferred-fixes`), plus the four `PreToolUse`
  edit hooks, which are offered `Bash` payloads so they can see a patch carried
  in a command — and every generated agent is told to use shell commands. What that flag leaves available under 0.144.1, and therefore whether
  those hooks can ever fire under this profile, was **not** established. It is
  item 5 of the checklist.
- **Per-hook trust.** Codex stores a hash per hook under `[hooks.state]` in the
  user config. A new hook, or one whose command changed, is listed in `/hooks`
  and does not run until approved there. After pulling a change to
  `.codex/hooks.json`, open `/hooks`.
- **Project trust.** An untrusted project's `.codex/` layer is loaded but
  disabled.
- **Linked worktrees read the main checkout's hooks.** Codex replaces a
  worktree's hooks with those of the root checkout, so a hook change is only
  exercised from the main checkout.
- **Subagents.** Under Claude Code, project hooks do not fire for subagents
  (`.claude/rules/gotchas-ops.md`). Whether they do under Codex was not measured.
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
  name mechanisms Codex does not have and are dropped — each with its reason in
  `agents.droppedFrontmatterKeys`, and a key not listed there stops the
  generator. **Consequences:** Codex has no per-agent tool allow-list, and no
  agent-scoped hooks, so the `block-writes.sh` guard the read-only reviewers
  carry under Claude Code is **absent**. `security-reviewer`, `test-reviewer`
  and the rest are read-only by instruction only.
- `code-architect.toml` is hand-authored: under Claude Code that seat is the
  `feature-dev:code-architect` plugin agent, which has no file in this
  repository to generate from. It is listed under `agents.handAuthored` in
  `tools/agentic-sync/port.json`; any other `.toml` there that the generator did
  not write is reported as `extra`.

## Skills

The 35 project skills under `.claude/skills/` are mirrored byte-for-byte into
`.agents/skills/`. The check is two-directional: a stale file, a missing file and
a hand-added file inside a mirrored directory all fail it.

`tools/agentic-sync/port.lock.json` records each generated path with the sha256
of what was written. When a path leaves the plan, `--write` deletes it **only if
the file still matches that hash**. A skill that was handed over — declared
`independent`, or moved to the `.agents/` side behind a symlink — is *released*
from the lock and never deleted; a file that was edited after generation is
reported as `modified` and left for a person. `.agents/skills/` also holds
third-party skills this tool does not own, and the lock is an editable text
file, so "the lock names it" is not on its own a reason to delete anything.

- **`.agents/skills/` is not Codex's alone.** Gemini CLI and Copilot read it too
  (`GEMINI.md`, the README tool table), so the mirror puts these 35 skills in
  front of them as well. They were written for Claude Code and name its tools;
  the generated *agents* carry a preface mapping those names to Codex's, the
  mirrored *skills* carry none, because they are byte-exact copies by design.
  `GEMINI.md` tells Gemini to translate tool names itself.
- **Why a copy and not a symlink.** Codex follows directory symlinks, and this
  repository already links the other way for third-party skills
  (`.claude/skills/tdd` → `.agents/skills/tdd`). But with `core.symlinks=false`
  — the Git for Windows default — a link checks out as a text file, so the
  skills would not exist on the platform Codex is used on here.
- **Not mirrored, and not yet resolved (#10131):** `game-engine`, `kanban` and
  `web-accessibility` exist as real directories on both sides and have drifted.
  Which side is canonical is undecided, so the generator leaves both alone
  (`skills.independent`). For these three, what a Codex user loads is **not** the
  Claude Code copy.
- **Only files git tracks are mirrored** — a stray `.env` or a `__pycache__`
  beside a skill script does not ride into a tracked directory. `--write` and
  `--check` both list what was left out; a file git *ignores* is only listed,
  while an untracked file it does not ignore is an `untracked:` problem, because
  it is about to be committed and its mirror would first be missed in CI. A symlink inside a skill is dereferenced under the same
  rule: it may only point at a tracked file.
- Executable bits follow the source: from the file's mode on disk where git
  trusts it (`core.fileMode=true`), from the index where it does not (Windows).
  There, a newly mirrored script has no index entry to repair yet, so the first
  `--write` names it and `--check` stays red until you `git add` and run
  `--write` again — otherwise the drift would first appear in CI.

## MCP servers

**`.codex/config.toml` declares no MCP servers today**, so a Codex session in
this repository has none of the servers in `.mcp.json` — Codex does not read that
file. The gate says so on every run and starts enforcing parity of server
**names** from the first `[mcp_servers.*]` table that is **committed**: like
`scripts/check-codex-config-safety.sh` it reads `HEAD:.codex/config.toml`, so an
uncommitted edit to that file does not turn a local check red. That is a
tolerance, not a recommendation: personal servers belong in the user-level
`~/.codex/config.toml`, as `docs/guides/taskboard-sync.md` says, because in a
linked worktree `worktree-safety-commit.sh` commits whatever is in the tree when
a session stops — and a committed personal block does turn the check red.
Commit all of the servers or none.

`.codex/config.toml` is covered by a `deny` rule in `.claude/settings.json`,
which stops *Claude Code* editing it; that rule does nothing under Codex (see
the `permissions.deny` row above). Adding the servers is therefore a hand edit,
tracked by #8767. What the contract rows above imply for whoever makes it:

- Forward secrets by **name** with `env_vars`. `${VAR}` interpolation is a Claude
  Code feature; Codex would pass the literal text.
- The committed profile runs with `approval_policy = "never"`. Per the contract
  table that does not auto-approve MCP calls under the workspace-write sandbox,
  but set `default_tools_approval_mode = "prompt"` on every server that holds a
  credential or reaches the network anyway, so a Stripe refund or a Neon branch
  delete stays human-gated if that default moves.
- A relative `command`/`args` path resolves against the directory Codex started
  in, not the repository root.

## First-run checklist

Unverified until someone does it; correct this file with what you find.

1. Started at the repo root and trusted, does `/hooks` list 29 handlers, and do
   they run once approved?
2. On Windows, which shell runs `commandWindows`, and does the relative path
   resolve?
3. Does an `apply_patch` edit to a file under `web/src/lib/` containing
   `db.transaction(` surface the `check-db-transaction.sh` warning to the model?
4. Does `$review-protocol` resolve, and does `spawn_agent` accept
   `security-reviewer`?
5. With `shell_tool = false` as committed, can the agent run a shell command at
   all, and does a `Bash`-matched hook (`block-main-commits.sh` on a commit to
   `main`) fire and block?
6. Does an edit made as `apply_patch <<'EOF' … EOF` in a shell command reach the
   `PreToolUse` edit hooks (it should, as tool `Bash`), and is it true that the
   `PostToolUse` payload for it carries no command?
7. Does the model ever send such a command with the exec tool's `workdir` set?
   If it does, do updates get blocked with the "working directory this hook
   cannot see" message, and how often — is that block a nuisance in practice?
8. How often is a shell command that merely QUOTES a patch (a doc, a fixture, a
   commit message) refused by the edit hooks, and does the model recover from
   the message on its own? If it is frequent, the allow-list's cost is too high
   as designed and this file should say so.
