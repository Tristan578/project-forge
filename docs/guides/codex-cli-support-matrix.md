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
| `[mcp_servers.<name>]` accepts `command`, `args`, `env`, `env_vars`, `cwd`, `default_tools_approval_mode` (`auto` \| `prompt` \| `writes` \| `approve`), `enabled_tools`, `disabled_tools`. `cwd` is kept as written (`codex mcp get --json` prints `".."` for `cwd = ".."`), not resolved against the config file | `config/src/mcp_types.rs`; `cwd` from `codex mcp get --json`, 0.144.1 |
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
  names no file, a shell command whose `command` is not a string, the script,
  bash or `jq` missing, a run that ends with exit 126/127 or cannot be
  completed, out of time — `jq` and exit 126/127 have entries under "Limits to
  know about") it exits 2 with the reason. Exit 1 there would let
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
    start with `-`, nothing but spaces, tabs and newlines after the closing
    delimiter (bash's idea of blank, not JavaScript's: a U+00A0 or a form feed
    there is a second command), **no carriage return anywhere except the one
    ending a line inside the patch body**, and a body that the port of Codex's
    own parser accepts. The carriage-return rule exists because two bashes read
    one differently (the suite prints what the bash it runs under does, on both
    CI platforms): to bash on Linux it is an ordinary byte, so `<<'EOF'<CR>`
    opens a heredoc that only `EOF<CR>` closes; Git for Windows' bash **deletes
    it wherever it stands** — mid-word, inside either kind of quote, inside a
    quoted heredoc body — so `EOF<CR>` closes a heredoc opened as `'EOF'`, and
    `Add File: we<CR>b/src/lib/x.ts` was shown to the hooks as a path no glob
    matched while bash handed `apply_patch` `web/src/lib/x.ts`. The one
    carriage return left alone ends a line inside the body, where Codex's parser
    strips it itself, so no path or added line can carry it. Then the base
    directory and every path are known, and each path is shown to the hook;
  - **refused** — everything else, without being parsed, so nothing in it can
    mislead. The hook blocks with a message giving the ways out.

  A command with no header line is an ordinary command: a patch that names no
  file edits nothing, so a `grep` for the envelope markers is left alone. That
  also covers a patch whose text is not in the command (`apply_patch < fix.patch`)
  or is assembled by the shell — a shell writing files, which no Edit/Write hook
  sees under Claude Code either. An `if` condition never gates a file hook on
  this channel. The cost in time is one short-lived `node` start per edit hook
  per shell command; the cost in false blocks is under "Limits to know about".

**`if` conditions.** Codex has no key for the `if` conditions in
`.claude/settings.json`: six hooks carry one, over four distinct patterns
(`Bash(git push *)` three times, `Bash(git commit *)`, `Bash(gh pr create *)`,
`Bash(gh api *)`). Only one of them is applied, and that is deliberate:

- **On `PreToolUse` a condition is never applied — the script always starts.**
  Every blocking Bash hook here routes on the command it is handed, and
  `block-main-commits.sh` does so with a normaliser hardened over many rounds
  (quotes, `$'…'`, a continuation inside a word, `git -C`). A filter in front of
  it is a second, weaker router: it skipped `g''it commit` and `git com\<LF>mit`,
  and the source's `Bash(git commit *)` never started that script for `merge`,
  `cherry-pick`, `revert` or `pull`, which it also exists to stop. Reading shell
  text to decide whether enforcement runs is the mistake this adapter made and
  removed twice for patches. The cost is that those five scripts start for every
  shell command and exit at their own first check.
- **On the non-gating events the condition is applied**, from the generated
  `.codex/hook-conditions.json`, because there an unfiltered run costs real work:
  `post-push-resolve-comments.sh` does not look at the command and would call
  `gh` after every shell command. Matching is generous — the words before the
  first `*` must appear in the command in that order, as words, with anything
  between them — and the generator accepts only the spelling that matcher can
  honour, `Bash(word [word…] *)`; `Bash(git push:*)` or `Bash(git push*)` stops
  it rather than being ported into a condition that can never match.

### Ported (29 handlers)

| Claude event | Codex event | Scripts |
|---|---|---|
| `SessionStart` | `SessionStart` | `on-session-start.sh` |
| `UserPromptSubmit` | `UserPromptSubmit` | `on-prompt-submit.sh` |
| `PreToolUse` `Edit\|Write\|Bash` | `PreToolUse` `apply_patch\|Bash` | `inject-lessons-learned.sh` |
| `PreToolUse` `Bash` | `PreToolUse` `Bash` | `pre-push-quality-gate.sh`, `block-main-commits.sh`, `check-pr-metadata.sh`, `check-docs-quality.sh`, `block-deferred-fixes.sh`. Each has an `if` in `.claude/settings.json`; under Codex it is **not applied** — the script always starts and routes on the command itself (see "`if` conditions" above). `block-deferred-fixes.sh` loses its `statusMessage` ("Checking for Boy Scout Rule violations") — see the note under this table |
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
- a handler whose group carries an `if` is matched for every shell command
  whatever becomes of the condition (see "`if` conditions" above). On `PreToolUse` the condition is never applied: the script starts each
  time and filters for itself, so "Checking for Boy Scout Rule violations" would
  show on an `ls`. On a non-gating event the adapter applies it and usually exits
  at once, so "Checking for unreplied review comments" would show on every
  command, where Claude Code shows it on `git push` alone.

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
| `permissions.deny` (Edit/Write on `.claude/settings.json`) and `permissions.ask` (Edit/Write on `.codex/config.toml`) | Claude Code permission rules, not hooks; Codex has no equivalent this repository configures. The ask rule makes a *Claude Code* edit to `.codex/config.toml` stop for a human in every Claude Code permission mode (#10134); a Codex session never reads it | The committed profile explicitly selects `on-request` and `workspace-write`. Codex applies its own sandbox protections independently of Claude rules; see `.claude/SANDBOX.md` for the scope and external-writer limitations. Review changes to both files |
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
  `*** Update File: ` or `*** Delete File: ` **after trimming whitespace**, so
  indenting a quoted patch does not avoid it. The message names the ways out:
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
  them and names the adapter rather than the check. The same holds on the patch
  tool for a patch that does not parse or a base directory that cannot be seen:
  every handler matched for the edit reports it — five on the tool channel
  (`inject-lessons-learned.sh` plus the four edit hooks), four on the shell
  channel. How Codex presents several blocking hooks to the model (the first, or
  all of them) was not verified.
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
- **`jq`.** Most shared scripts parse their input with `jq` — every blocking
  Bash hook among them — and the adapter asks the bash it is about to use for
  `jq` before it starts any script. Without it **no script is started**, the ones
  that do not use `jq` included: every handler that would have started one
  blocks on `PreToolUse` and is reported as failed elsewhere, and the message
  names `jq` and `.codex/AGENTS.md`, "Requirements on PATH". (A handler that has
  nothing to do exits before the question is asked — an edit hook matched for a
  shell command that carries no patch, a conditional hook whose condition does
  not hold — so an `ls` is blocked by the hooks that inspect shell commands while
  the edit handlers matched for it stay silent.) All-or-nothing is deliberate — the
  gap shows at session start instead of at the first push, and asking "does this
  script use `jq`" would mean reading shell text, through every file it sources,
  to decide whether a check runs. It costs one ~50 ms bash start per hook
  (measured on Windows). Left to themselves the scripts split two ways,
  both wrong (measured with `jq` off `PATH`): `pre-push-quality-gate.sh` and
  `check-sanitization-patterns.sh`, which call `jq` directly under `set -e`, end
  with exit 127 and no message, because their own `2>/dev/null` swallows bash's
  "jq: command not found"; the others read nothing, take their "nothing to
  inspect" branch and pass — `check-pr-metadata.sh` among them although it is
  under `set -e` too, because its only `jq` call sits inside a command
  substitution, where bash clears `-e`. Under Claude Code that split is what
  happens today.
- **Exit 126 and 127 from a script block on `PreToolUse`** and say that the check
  did not run. They mean "found but not executable" and "command not found" — of
  the script itself *or of anything it calls* — so the message cannot say which.
  It prints the script's stderr when there is any, says that bash and `jq` have
  just answered (so it is neither), and gives the command that finds the culprit:
  `bash -x .claude/hooks/<name>`. The scripts call more than the four tools under
  "Requirements on PATH" — `python3`, `gh`, `curl`, `npx` among them.
- **A `PreToolUse` check that gates on file paths must live in an
  `Edit|Write`-only group.** Only such a group is wired for both edit channels:
  the adapter runs it in a mode that acts on a patch carried in a shell command
  and on nothing else in that command. A group that also matches `Bash` (or has
  no matcher) is run the other way — the shell command is passed through as a
  command, and a patch carried in it is **not** split into files. There is no
  mode that does both. One hook has that shape today, `inject-lessons-learned.sh`,
  which only advises and matches on the whole command text; the generator names
  every such hook in a note on each run.

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

The 38 project skills under `.claude/skills/` are mirrored byte-for-byte into
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
  (`GEMINI.md`, the README tool table), so the mirror puts these 38 skills in
  front of them as well. They were written for Claude Code and name its tools;
  the generated *agents* carry a preface mapping those names to Codex's, the
  mirrored *skills* carry none, because they are byte-exact copies by design.
  `GEMINI.md` tells Gemini to translate tool names itself.
- **Why a copy and not a symlink.** Codex follows directory symlinks, and this
  repository already links the other way for third-party skills
  (`.claude/skills/tdd` → `.agents/skills/tdd`). But with `core.symlinks=false`
  — the Git for Windows default — a link checks out as a text file, so the
  skills would not exist on the platform Codex is used on here.
- **`.claude/skills/` is the canonical side for every project skill (#10131).**
  `game-engine`, `kanban` and `web-accessibility` used to exist as real,
  drifted directories on both sides and were listed under `skills.independent`
  so the generator overwrote neither. The `.claude/` copies were the newer,
  SpawnForge-specific ones (the MCP-tool kanban protocol, the `paths:`-scoped
  accessibility skill, the ECS and command-dispatch references), and the
  `.agents/` copies were the generic upstream imports. Everything the `.agents/`
  side had that the `.claude/` side lacked was merged into `.claude/` first — the
  five game-engine starter templates under `assets/` (the skill body already
  referred to them) and nine generic references, plus the filtered-list and
  delete rows of the kanban REST table — and the three are now mirrored like
  the rest. `skills.independent` is empty; a skill that must diverge again is
  declared there deliberately, never by editing `.agents/` in place.
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

Approval behavior was exercised on Windows with codex-cli 0.153.4 on
2026-09-23 using an isolated stdio `ping` server and loopback mock Responses
API (no external model request or credentials). Actual model-produced tool
calls used `workspace-write`: `on-request` prompted, acceptance invoked ping
once, and declining invoked it zero additional times. With `never`, no prompt
was emitted and the tool was rejected with “MCP tool call requires approval,
but approval policy is never.” This proves the approval path, not authenticated
third-party service access.

**`.codex/config.toml` declares the same MCP servers as `.mcp.json`** (#10134). Codex does not read `.mcp.json`, so without those tables a Codex
session in this repository would have none of them. The gate compares every
server declared on both sides: the **names** must match, and each server's
`command` and `args` must equal its `.mcp.json` entry exactly, with every `${VAR}`
secret forwarded by name in `env_vars` and every literal `env` value restated
verbatim. It also requires `default_tools_approval_mode = "prompt"` in every
server's own table (see the list below), which `.mcp.json` has no counterpart
for, and fails a `command`, arg or `cwd` that Codex would resolve against the
directory the session started in (the last item below). It does not compare any
other key in a server table. Compared scalar properties must be strings; `args`
and `env_vars` must be arrays containing only strings. Scalar/array substitutions,
nested arrays and mixed value types fail. Strings are compared decoded, as TOML 1.0 defines
them: `"C:\\x"` is `C:\x`, and a `'literal string'` is taken as written. A string
the check cannot read is reported rather than compared: an escape TOML 1.0 does
not define (a Windows path written `"C:\Users"`), an unclosed string, or any
multi-line `"""…"""`/`'''…'''` string, whose body the line-based reader would
take for keys. Inside a server table it fails that server, whichever key holds
it; outside every server table it stops the check, since there it could pose as
a whole `[mcp_servers.…]` table. Like
`scripts/check-codex-config-safety.sh` it reads the **committed**
`HEAD:.codex/config.toml`, so an uncommitted edit to that file does not turn a
local check red. That is a tolerance, not a recommendation: personal servers
belong in the user-level `~/.codex/config.toml`, because in a linked worktree
`worktree-safety-commit.sh` commits whatever is in the tree when a session
stops — and a committed personal block does turn the check red. Every server
in `.mcp.json` must be declared, including when all Codex tables are removed.
Deleting either configuration file also fails; only two absent files or two
explicitly empty server sets have no MCP parity requirements.

`.codex/config.toml` is hand-maintained. A *Claude Code* `Edit` or `Write` to it
is an `ask` rule in `.claude/settings.json`: a human approves each edit, in every
Claude Code permission mode, because each server table is a command the next
Codex session runs. It used to be a hard `deny`, lifted in #10134 because it
made the file unmaintainable by an agent even with a human watching. Neither
rule does anything under Codex (see the permission-rules row above), and shell writes have different enforcement — `.claude/SANDBOX.md` has the full list of what does and
does not guard this file. Secret-shaped content is covered repo-wide by GitHub
secret-scanning push protection, which rejects a recognised credential at push
time for every file and every actor. What the contract rows above imply for
whoever edits a server:

- Forward secrets by **name** with `env_vars`. `${VAR}` interpolation is a Claude
  Code feature; Codex would pass the literal text.
- The committed profile uses `approval_policy = "on-request"` and explicit
  `sandbox_mode = "workspace-write"`. Every server retains
  `default_tools_approval_mode = "prompt"` so interactive sessions can request
  permission for tool calls. A headless `codex exec` cannot answer that prompt;
  unattended jobs need narrow, explicit per-tool approvals in their own profile.
  Server startup alone does not prove tool execution. The parity gate rejects
  missing or non-prompt server defaults.
- A relative `command`/`args` path resolves against the directory Codex started
  in, not the repository root, and so does a relative `cwd`: Codex does not
  resolve it against `.codex/`. A server whose launcher is a file in this
  repository therefore goes through a git alias, which git runs from the
  repository's top-level directory (git-config(1), `alias.*`). taskboard is
  launched that way, in `.mcp.json` and here alike:
  `git -c "alias.spawnforge-taskboard=!node .claude/hooks/taskboard-launch.mjs" spawnforge-taskboard mcp`.
  `port.mjs --check` fails a `command` or arg that is explicitly relative (`./…`,
  `../…`) or names a path that exists relative to the repository root, and any
  relative `cwd`. A path absolute on either convention is not relative: POSIX
  `/…`, or Windows `C:\…`, `C:/…`, `\\host\share` and `\…` (the root of the
  current drive). `scripts/__tests__/check-codex-port.test.sh` runs the
  committed taskboard command from `tools/agentic-sync/`. Observed with
  codex-cli 0.144.1 on Windows 11 on 2026-09-23, through `codex app-server`
  (`thread/start` with `ephemeral: true`, then `mcpServerStatus/list`; no turn,
  so no model request):
  - Started in `web/src`, the committed taskboard entry reached `ready` with the
    board's 21 tools. The previous `node .claude/hooks/taskboard-launch.mjs mcp`
    failed from the same directory with "handshaking with MCP server failed:
    connection closed: initialize response".
  - In a scratch repository started two levels down, a probe server with
    `cwd = ".."` reported the directory one level above the START directory.
    Resolved against the config file, it would have been the repository root.
    The same probe behind a git alias reported the repository root.

MCP parity decodes bare, basic-quoted, and literal-quoted table/key names,
including whitespace around dotted table paths. Inline or dotted MCP server
declarations, inline environment tables, and unsupported MCP sub-tables fail
with a diagnostic; use explicit server tables and their optional env sub-table.
Secret forwarding requires matching source and destination variable names;
Codex env_vars cannot implement a Claude variable alias.

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
