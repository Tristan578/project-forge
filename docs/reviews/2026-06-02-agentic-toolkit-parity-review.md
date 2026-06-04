# Agentic Toolkit Parity Review — 2026-06-02

> **Scope.** The repo's *agentic toolkit* — every config that powers an AI coding
> assistant, across all providers, not just Claude Code. Judged on two axes against
> each provider's **current** capability surface (as of 2026-06-02): **DEPTH** (are we
> using the full live capability set, or stale/deprecated patterns?) and **PARITY**
> (does a Codex / Gemini / Copilot contributor get an experience equivalent to a Claude
> Code contributor?).
>
> **Providers in scope:** Claude Code + Claude Agent SDK, OpenAI Codex CLI, Google
> Gemini CLI, GitHub Copilot CLI (+ gh-aw). Noted but not deep-dived: Cursor
> (`.cursorrules` only — no `.cursor/`), Windsurf (`.windsurf/`).
>
> **Method.** Phase A inventory (per-provider file read) → Phase B external baseline
> (every capability claim grounded in an official changelog/doc URL + date; training
> memory is *not* trusted) → Phase C depth×parity matrix → Phase D adversarial
> verification (each finding independently re-checked against the repo **and** a
> **second source distinct from the original citation**; default `real=false`; only
> confirmed findings kept).

**Verified result: 41 real gaps — 2 P0, 5 P1, 26 P2, 8 P3.** One drafted gap
(`.windsurf/rules` duplicate-without-sync) was **dropped** by adversarial verification
as not-real. All 41 below survived a two-source check.

## Executive summary

The single structural finding behind most of the parity gaps: **there is no
source-of-truth generator.** Each provider's instruction/agent/skill surface is
hand-mirrored, so they drift independently and even *contradict each other* on basic
facts (command count, test-coverage thresholds, Zod-vs-`parseArgs` validation, WASM
budget), and the live taskboard/team IDs that the workflow actually needs exist in
**zero** provider instruction files. Claude Code is the only surface that is
"current" across most dimensions; Codex and Gemini are *absent* on subagents, MCP,
plan mode, and plugins despite all four being GA on those providers today.

The one **security** finding (`Settings#0`) is nuanced: the *committed* `.codex/
config.toml` is the safe, approval-gated profile — every contributor who pulls `main`
gets that. The fully-unattended/network-open profile exists only as a deliberate,
uncommitted local working-tree edit. The actionable, in-bounds remediation is a guard
that prevents the permissive profile from ever being *committed* silently — not a
change to the file itself.

## Depth × Parity matrix (9 dimensions × 4 providers)

Legend: ✅ present & current · ⚠️ present but stale/deprecated content · ◐ partial ·
❌ absent (capability exists upstream, unused here) · — n/a

| Dimension | Claude Code | Codex CLI | Gemini CLI | Copilot CLI |
|---|:--:|:--:|:--:|:--:|
| Subagents / specialized agents | ✅ | ❌ | ❌ | ⚠️ |
| Skills & custom slash-commands / prompts | ✅ | ◐ | ◐ | ◐ |
| Hooks & lifecycle events | ✅ | ⚠️ | ✅ | ◐ |
| MCP server integration | ✅ | ❌ | ❌ | ◐ |
| Memory / instruction files (persistent context) | ✅ | ◐ | ⚠️ | ⚠️ |
| Plan mode / planning workflow | ◐ | ❌ | ❌ | ❌ |
| Settings & permission / sandbox model | ◐ | ⚠️ | ◐ | ◐ |
| Plugins / extensions / marketplace | ◐ | ❌ | ❌ | ⚠️ |
| Single-source-of-truth & contributor onboarding (parity meta-dimension) | ✅ | ⚠️ | ⚠️ | ⚠️ |

**Per-cell detail** (what each glyph means, from the inventory + baseline):

<details><summary><b>Subagents / specialized agents</b></summary>

- **Claude Code** — ✅ current: 12 subagents in .claude/agents/*.md with per-agent model/tools/mcpServers/hooks/skills/isolation; matches GA .claude/agents/ format. CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 set. One defect: planner.md has a duplicate YAML 'hooks:' key (Stop block silently dropped).
- **Codex CLI** — ❌ absent: No .codex/agents/ directory and no [agents] config (max_threads/max_depth) in .codex/config.toml, despite Codex subagents being GA and enabled-by-default (TOML files in .codex/agents/). Zero specialized agents configured.
- **Gemini CLI** — ❌ absent: No .gemini/agents/ directory; .gemini/settings.json wires only model/context/hooks. Gemini CLI subagents (GA Apr 2026, .gemini/agents/*.md) are entirely unused. Note: Gemini CLI consumer access sunsets 2026-06-18 → Antigravity CLI, which carries subagents over.
- **GitHub Copilot CLI** — ⚠️ stale: 4 agents in .github/agents/*.md (rust-engine, security-reviewer, test-writer, docs-maintainer) using the GA Copilot agent format. Stale content: agents cite 322/326 commands (real 350), test thresholds 44/36/39/45→55/45/50/55 (real 70/60/65/72), and contradict each other on Zod vs parseArgs and WASM size budget.

</details>

<details><summary><b>Skills & custom slash-commands / prompts</b></summary>

- **Claude Code** — ✅ current: 53 SKILL.md skills under .claude/skills/, invocable as /<name>; matches current GA skills standard (commands merged into skills). But ~10 agent-referenced skills (game-engine-ux-patterns, dx-*-patterns, etc.) are dangling/unresolvable, and skill/agent name collisions (builder, planner, rust-engine) blur the two surfaces.
- **Codex CLI** — ◐ partial: 3 skills exist with correct frontmatter under .agents/skills/ (Codex's documented discovery path) so they ARE discoverable; but duplicate copies in .codex/skills/ are plain Markdown with NO name/description frontmatter, are off the documented discovery path, and are dead/orphaned. No use of Codex's deprecated custom-prompts (correct). Effectively inherits the full 24-skill .agents/skills set, far more than the 3 .codex AGENTS.md implies.
- **Gemini CLI** — ◐ partial: 24 SKILL.md skills load via .agents/skills (Gemini alias of .gemini/skills) — GEMINI.md undercounts to 3. Zero use of Gemini's first-class .gemini/commands/*.toml custom slash-command surface ({{args}}, shell injection) — no .gemini/commands dir exists, leaving a whole documented mechanism unused.
- **GitHub Copilot CLI** — ◐ partial: 3 .github/skills/ SKILL.md (CLI-honored, correct) PLUS 2 .github/prompts/*.prompt.md with agent: coding-agent — but per baseline .prompt.md is IDE-only (preview) and NOT honored by the CLI, so the prompt copies are dead weight for the CLI and duplicate the skills. Custom slash commands (via /agent custom agents) unused.

</details>

<details><summary><b>Hooks & lifecycle events</b></summary>

- **Claude Code** — ✅ current: settings.json wires ~37 entries across 19 lifecycle events (SessionStart, PreToolUse, PostToolUse, SubagentStop, PreCompact/PostCompact, TaskCreated/Completed, etc.); exit-2 fail-closed contract; matches the GA ~29-event surface, though only 2 of 48 hook scripts have co-located tests.
- **Codex CLI** — ⚠️ stale: .codex/AGENTS.md declares 'Codex CLI does not support lifecycle hooks' and tells the user to run .claude/hooks/*.sh MANUALLY — but Codex hooks (hooks.json / [hooks] in config.toml; SessionStart/PreToolUse/PostToolUse/SubagentStop/Stop/PreCompact etc.) are GA. Zero native hooks configured.
- **Gemini CLI** — ✅ current: .gemini/settings.json wires all 4 of Gemini's native lifecycle events it uses (SessionStart, BeforeAgent, AfterAgent, AfterTool[WriteFile|EditFile]) to shared .claude/hooks scripts; events are valid per the GA hooks reference. No co-located tests, and BeforeModel/AfterModel/BeforeToolSelection are unused (acceptable).
- **GitHub Copilot CLI** — ◐ partial: 3 .github/hooks/*.json configs wire sessionStart, userPromptSubmitted, postToolUse — but postToolUse is mapped to on-stop.sh (a Stop-event worktree-commit/sync script that fires 'after the AI finishes responding'), a lifecycle mismatch firing after every tool call. agentStop/Stop, preToolUse, subagentStart/Stop, preCompact, sessionEnd events documented in baseline are unused.

</details>

<details><summary><b>MCP server integration</b></summary>

- **Claude Code** — ✅ current: .mcp.json declares 7 stdio MCP servers (context7, neon, playwright, github, sentry, stripe, upstash) with env-var expansion; per-agent scoping wires github→infra-devops, context7→rust-engine, playwright→ux-reviewer+validator. Uses stdio only — no HTTP/streamable-http, OAuth, or Tool Search alwaysLoad config.
- **Codex CLI** — ❌ absent: .codex/config.toml has NO [mcp_servers] block; AGENTS.md references only SpawnForge's own mcp-server/ test suite, not client MCP. Codex CLI is a documented MCP client (stdio + streamable-HTTP) — capability fully unused.
- **Gemini CLI** — ❌ absent: .gemini/settings.json contains only model/context/hooks keys — no mcpServers object. Gemini CLI natively supports MCP via settings.json mcpServers (command/url/httpUrl). Zero servers wired despite the project running 7 on the Claude side.
- **GitHub Copilot CLI** — ◐ partial: Interactive CLI surface (.github/skills, copilot-instructions) wires NO mcp-config.json. The 5 gh-aw cloud workflows DO configure a read-only github MCP (toolsets context/repos/issues/pull_requests, github-mcp-server:v0.31.0) via the gateway — but run copilot with --disable-builtin-mcps and no project/3rd-party MCP. No local copilot MCP for contributors.

</details>

<details><summary><b>Memory / instruction files (persistent context)</b></summary>

- **Claude Code** — ✅ current: Layered + current: root CLAUDE.md + .claude/CLAUDE.md + 7 .claude/rules/*.md + per-agent .claude/agent-memory/ + user-scoped auto-memory MEMORY.md (Claude-written). @-imports used; MEMORY.md is the canonical source for live taskboard/team IDs. Does NOT import shared AGENTS.md (correctly, per baseline AGENTS.md is not read directly).
- **Codex CLI** — ◐ partial: .codex/AGENTS.md present and points to .claude/* as deep reference, but is a hand-maintained copy that does NOT use Codex's documented AGENTS.override.md override-first mechanism (none exists in repo) and carries stale Project ID 01KK974... + the forbidden `--db` flag. project_doc fallback/override surface unused.
- **Gemini CLI** — ⚠️ stale: Current mechanism wired: .gemini/settings.json context.fileName auto-loads [GEMINI.md, AGENTS.md, .claude/CLAUDE.md, CLAUDE.md] and GEMINI.md uses @AGENTS.md import. But content is stale: hardcodes dead Project ID 01KK974.../team 01KK9751..., the forbidden `--db` flag, localhost:3010, and undercounts skills (says 3, disk has 24).
- **GitHub Copilot CLI** — ⚠️ stale: Honors the full current set: AGENTS.md + .github/copilot-instructions.md + path-scoped .github/instructions/*.instructions.md (applyTo: "**" confirmed). But files self-contradict (Zod vs parseArgs validation rule) and carry stale 326/322 MCP counts, stale 55/45/50/55 thresholds, and dead taskboard IDs.

</details>

<details><summary><b>Plan mode / planning workflow</b></summary>

- **Claude Code** — ◐ partial: No native plan mode wired (no permissionMode/defaultMode/plan key in .claude/settings.json) despite GA support; planning is convention-only via planner agent (claude-opus-4-7), architect-flow/planner/cycle skills, and a spec-completeness-check Stop hook — which is itself silently DROPPED by a duplicate 'hooks:' YAML key in planner.md (line 9 Stop overridden by line 13 PreToolUse).
- **Codex CLI** — ❌ absent: Codex supports /plan + GA Goal mode (/goal, GA 2026-05-21) but .codex/ wires neither; .codex/AGENTS.md has zero plan/goal references — planning is only the ticket-as-plan kanban discipline (3 subtasks + 3 Given/When/Then), with no automated planner.
- **Gemini CLI** — ❌ absent: Gemini has GA, default-on plan mode (/plan, --approval-mode=plan, Shift+Tab) but .gemini/settings.json wires only model/context/hooks — no approval-mode/plan config; planning is ticket-as-plan via the BeforeAgent on-prompt-submit.sh gate only, no planner agent or plan-mode toggle.
- **GitHub Copilot CLI** — ❌ absent: Copilot CLI has GA plan mode (Shift+Tab, --plan/--mode plan, /plan) plus a built-in Plan agent, but the repo's Copilot config (.github/) surfaces none of it; .github/prompts/ holds only sync-pull/sync-push and planning is the ticket-as-plan mandate in copilot.instructions.md enforced by the on-prompt-submit.sh hook.

</details>

<details><summary><b>Settings & permission / sandbox model</b></summary>

- **Claude Code** — ◐ partial: Real shared config is fail-closed PreToolUse gate hooks (block-main-commits, check-pr-metadata, block-deferred-fixes, pre-push-quality-gate, verify-branch) + reviewer block-writes.sh; but settings.json has NO permissions allow/ask/deny block, NO permissionMode, NO Bash sandbox. The only allow-list is in .claude/settings.local.json which is gitignored (unshared), and auto-approve-safe-commands.sh is a PermissionRequest hook that is never wired (no PermissionRequest event) = dead code. **[Resolved — #8690]** A committed `permissions` block (curated `allow` read/build/test rules + `deny` guards on the two off-limits config files, root-anchored for both Edit and Write) now ships in `settings.json`, and `auto-approve-safe-commands.sh` was repaired (relabelled to its real `PreToolUse` event, emits an `allow`/`ask` decision instead of a blunt `exit 2`, drops `npm exec`, gates compound/redirected/substituted commands) and wired as a `PreToolUse` Bash hook.
- **Codex CLI** — ⚠️ stale: .codex/config.toml is the only native approval_policy + sandbox_mode + workspace-write-network + features config in the repo, BUT the working tree has uncommitted permissive edits (approval_policy=never, sandbox_mode=workspace-write, network_access=true, shell_tool=true, web_search=true) that diverge from the restrictive committed HEAD (unless-allow-listed, shell_tool=false).
- **Gemini CLI** — ◐ partial: .gemini/settings.json configures only model/context/hooks. No approval-mode (default/auto_edit/plan/yolo), no tools.sandbox (docker/podman/seatbelt), and checkpointing is left at its default-off — all three are GA and unused; enforcement is purely behavioral via the BeforeAgent ticket-gate + AfterTool lint hooks.
- **GitHub Copilot CLI** — ◐ partial: No ~/.copilot/config.json trustedFolders, no /sandbox enable, no --allow-tool/--deny-tool/--available-tools config in-repo. CLI-side enforcement is only scripts/copilot-arch-check.sh (postToolUse, exit 1 on bridge/WASM/eslint/tsc violation); the capability-scoped permissions:/safe-outputs: model exists only for the cloud gh-aw workflows, not the interactive CLI.

</details>

<details><summary><b>Plugins / extensions / marketplace</b></summary>

- **Claude Code** — ◐ partial: A local plugin manifest exists (.claude-plugin/plugin.json 'spawnforge' v1.0.0) but declares ZERO components (no commands/agents/hooks/.mcp.json/.lsp.json/monitors) — the rich .claude/ tree (12 agents, 53 skills, 48 hooks, 7 MCP) is the de-facto source, not the plugin bundle. 3 hookify rule files present. No marketplace published/consumed in-repo.
- **Codex CLI** — ❌ absent: Codex supports plugins since 2026-03-25 (bundles of skills/MCP/hooks) with marketplace sharing, but .codex/ has only config.toml, AGENTS.md, and 3 plain-Markdown skills — no plugin manifest, no hooks, no MCP. None of Codex's plugin packaging is used.
- **Gemini CLI** — ❌ absent: Gemini CLI supports Extensions (bundle MCP/commands/hooks/subagents/skills, install via `gemini extensions install`, public Gallery), but .gemini/ has only settings.json (model/context/4 hooks) — no gemini-extension.json, no MCP. Automation is inherited from .claude/ and .agents/, not packaged as a Gemini extension.
- **GitHub Copilot CLI** — ⚠️ stale: GitHub Agentic Workflows (gh-aw) IS the extension surface — 5 compiled copilot-engine workflows + actions-lock.json. But stale: actions-lock.json pins setup@v0.53.1 / compiler_version v0.53.1 while committed .lock.yml files reference setup@v0.65.0 — `gh aw compile` out of sync with the recorded pin. Copilot's first-class plugins (/plugin install bundling agents/skills/hooks/MCP) are NOT used — the 4 agents/3 skills/2 prompts/3 hook configs are loose files.

</details>

<details><summary><b>Single-source-of-truth & contributor onboarding (parity meta-dimension)</b></summary>

- **Claude Code** — ✅ current: Richest, freshest onboarding surface: CLAUDE.md + .claude/CLAUDE.md constitution + 9 .claude/rules/*.md + user-scoped MEMORY.md, all actively maintained (CLAUDE.md touched 2026-06-02). This is the de-facto source-of-truth that every other provider points back to.
- **Codex CLI** — ⚠️ stale: .codex/AGENTS.md uses Codex's GA AGENTS.md memory mechanism but hardcodes stale taskboard IDs (01KK974.../01KK9751), the banned `--db` flag, and localhost:3010; last touched 2026-03-20, months behind .claude/.
- **Gemini CLI** — ⚠️ stale: GEMINI.md + @AGENTS.md import (GEMINI.md uses Gemini's GA context.fileName + @-import). Carries localhost:3010 and an undercounted skill list (says 3, disk has 24); inherits stale AGENTS.md IDs via the import.
- **GitHub Copilot CLI** — ⚠️ stale: Honors GA AGENTS.md + .github/copilot-instructions.md + *.instructions.md, but the two instruction files directly CONTRADICT each other (Zod vs parseArgs) and cite a stale 326/322 command count (actual 350).

</details>

## External baseline (Phase B) — cited, current capabilities

Every capability below is grounded in an official source (URL + access date). GA vs
beta vs experimental is the provider's own labelling where stated; where a page
carried no explicit GA tag, status was inferred from "enabled by default" / shipped
changelog signals and is flagged in *Unverifiable/ambiguous claims*.

### Anthropic Claude Code + Claude Agent SDK

| Dimension | Status | Source | Accessed |
|---|---|---|---|
| subagents / specialized agents | ga | [code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents) | 2026-06-02 |
| skills & custom slash-commands / prompt files | ga | [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills) | 2026-06-02 |
| hooks & lifecycle events | ga | [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks) | 2026-06-02 |
| MCP server integration | ga | [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp) | 2026-06-02 |
| memory / instruction files | ga | [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory) | 2026-06-02 |
| plan mode / planning workflow | ga | [code.claude.com/docs/en/permission-modes](https://code.claude.com/docs/en/permission-modes) | 2026-06-02 |
| settings & permission / sandbox / approval model | ga | [code.claude.com/docs/en/permission-modes](https://code.claude.com/docs/en/permission-modes) | 2026-06-02 |
| plugins / extensions / marketplace | ga | [code.claude.com/docs/en/plugins](https://code.claude.com/docs/en/plugins) | 2026-06-02 |
| Claude Agent SDK | ga | [code.claude.com/docs/en/agent-sdk/overview](https://code.claude.com/docs/en/agent-sdk/overview) | 2026-06-02 |

_Flagged unverifiable/ambiguous claims for this provider: 6._

### OpenAI Codex CLI

| Dimension | Status | Source | Accessed |
|---|---|---|---|
| subagents / specialized agents | ga | [developers.openai.com/codex/subagents](https://developers.openai.com/codex/subagents) | 2026-06-01 |
| skills & custom slash-commands / prompt files | ga | [developers.openai.com/codex/skills](https://developers.openai.com/codex/skills) | 2026-06-01 |
| hooks & lifecycle events | ga | [developers.openai.com/codex/hooks](https://developers.openai.com/codex/hooks) | 2026-06-01 |
| MCP server integration | ga | [developers.openai.com/codex/mcp](https://developers.openai.com/codex/mcp) | 2026-06-01 |
| memory / instruction files | ga | [developers.openai.com/codex/guides/agents-md](https://developers.openai.com/codex/guides/agents-md) | 2026-06-01 |
| plan mode / planning workflow | ga | [developers.openai.com/codex/changelog](https://developers.openai.com/codex/changelog) | 2026-05-21 |
| settings & permission / sandbox / approval model | ga | [developers.openai.com/codex/config-reference](https://developers.openai.com/codex/config-reference) | 2026-06-01 |
| plugins / extensions / marketplace | ga | [developers.openai.com/codex/changelog](https://developers.openai.com/codex/changelog) | 2026-06-02 |

_Flagged unverifiable/ambiguous claims for this provider: 6._

### Google Gemini CLI

| Dimension | Status | Source | Accessed |
|---|---|---|---|
| subagents / specialized agents | ga | [github.com/google-gemini/gemini-cli/blob/main/do](https://github.com/google-gemini/gemini-cli/blob/main/docs/core/subagents.md) | 2026-04-15 |
| skills & custom slash-commands / prompt files | ga | [geminicli.com/docs/cli/custom-commands/](https://geminicli.com/docs/cli/custom-commands/) | 2026-05-29 |
| hooks & lifecycle events | ga | [github.com/google-gemini/gemini-cli/blob/main/do](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md) | 2026-01-28 |
| MCP server integration | ga | [github.com/google-gemini/gemini-cli/blob/main/do](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md) | 2026-05-29 |
| memory / instruction files | ga | [geminicli.com/docs/cli/gemini-md/](https://geminicli.com/docs/cli/gemini-md/) | 2026-05-29 |
| plan mode / planning workflow | ga | [geminicli.com/docs/cli/plan-mode/](https://geminicli.com/docs/cli/plan-mode/) | 2026-05-13 |
| settings & permission / sandbox / approval model | ga | [geminicli.com/docs/reference/configuration/](https://geminicli.com/docs/reference/configuration/) | 2026-05-29 |
| plugins / extensions / marketplace | ga | [geminicli.com/docs/extensions/](https://geminicli.com/docs/extensions/) | 2026-02-17 |

_Flagged unverifiable/ambiguous claims for this provider: 6._

### GitHub Copilot CLI + coding agent

| Dimension | Status | Source | Accessed |
|---|---|---|---|
| subagents / specialized agents | ga | [github.blog/changelog/2026-02-25-github-copilot-](https://github.blog/changelog/2026-02-25-github-copilot-cli-is-now-generally-available/) | 2026-02-25 |
| skills & custom slash-commands / prompt files | ga | [github.blog/changelog/2025-12-18-github-copilot-](https://github.blog/changelog/2025-12-18-github-copilot-now-supports-agent-skills/) | 2025-12-18 |
| hooks & lifecycle events | ga | [docs.github.com/en/copilot/reference/hooks-confi](https://docs.github.com/en/copilot/reference/hooks-configuration) | 2026-06-02 |
| MCP server integration | ga | [docs.github.com/en/copilot/how-tos/copilot-cli/u](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/overview) | 2026-06-02 |
| memory / instruction files | ga | [docs.github.com/en/copilot/how-tos/copilot-cli/c](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions) | 2026-06-02 |
| plan mode / planning workflow | ga | [github.blog/changelog/2026-02-25-github-copilot-](https://github.blog/changelog/2026-02-25-github-copilot-cli-is-now-generally-available/) | 2026-02-25 |
| settings & permission / sandbox / approval model | ga | [docs.github.com/en/copilot/reference/copilot-cli](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) | 2026-06-02 |
| plugins / extensions / marketplace | ga | [docs.github.com/en/copilot/concepts/agents/copil](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-cli-plugins) | 2026-06-02 |

_Flagged unverifiable/ambiguous claims for this provider: 6._

## Prioritized findings & remediations

Severity is the **adversarially-confirmed** value (may differ from the draft). Each
finding lists the cited upstream feature it depends on and the independent second
source that confirmed the feature is real/GA.

### P0 — Production / contributor-safety blockers

#### `Settings & permi#0` — Codex sandbox/approval config committed-vs-working-tree divergence ships an unattended, network-open, shell-enabled profile

- **Type / providers:** depth · Codex CLI
- **Cited feature:** Codex sandbox modes (read-only, workspace-write, danger-full-access) and approval policy (untrusted, on-request, never), plus [sandbox_workspace_write] network_access and [features] shell_tool/web_search
- **Source:** https://developers.openai.com/codex/config-reference
- **2nd source (Phase D):** https://codex.danielvaughan.com/2026/04/08/codex-cli-configuration-reference/
- **Remediation:** Decide one source of truth and commit it. If unattended runs are intended, commit the permissive config WITH a comment and a guardrail (keep approval_policy='on-request' for write/network tools rather than 'never', and scope network via an allowlist if Codex supports it); if not, run `git checkout .codex/config.toml` to discard the working-tree edits and keep the restrictive HEAD. Add a CI check (extend scripts/check-lockfile-sync.sh-style gate) that fails if .codex/config.toml sets approval_policy='never' together with network_access=true, so a permissive profile can never land silently.

#### `Single-source-of#0` — No source-of-truth generator: cross-tool onboarding files are hand-mirrored and have drifted into mutual contradiction

- **Type / providers:** parity · Codex CLI, Gemini CLI, GitHub Copilot CLI
- **Cited feature:** memory / instruction files — Codex honors AGENTS.md/AGENTS.override.md; Gemini honors GEMINI.md with @file imports and configurable context.fileName; Copilot honors AGENTS.md + copilot-instructions.md
- **Source:** https://developers.openai.com/codex/guides/agents-md
- **2nd source (Phase D):** https://agents.md/
- **Remediation:** Add scripts/gen-agent-configs.mjs (root, ~150 LoC) that reads a single YAML source (e.g. .claude/agent-shared.yml holding canonical taskboard Project ID 01KMM9ZA6SBZ7RKJZJTZS9VR4R, team IDs 01KMR5E36..., taskboard URL taskboard.localhost:1355, NO --db, command count, test count) plus the shared rules, and emits AGENTS.md, .cursorrules, GEMINI.md, .codex/AGENTS.md, and .windsurf/rules/*. Wire it as a CI check (regenerate + git diff --exit-code, mirroring the existing check-manifest-sync.ts pattern in apps/docs/scripts/) so any hand-edit that diverges fails the PR. As a first pass, immediately replace the stale IDs/`--db`/localhost:3010 in all 5 files.

### P1 — A non-Claude contributor cannot use/extend core tooling, or a major current feature is unused

#### `Memory / instruc#0` — Live taskboard/team IDs exist in ZERO provider instruction files — every non-Claude contributor is steered to a dead project

- **Type / providers:** parity · Codex CLI, Gemini CLI, GitHub Copilot CLI
- **Cited feature:** memory / instruction files — Codex honors AGENTS.md/AGENTS.override.md (project_doc chain rebuilt each run); Gemini loads GEMINI.md/AGENTS.md via context.fileName; Copilot honors AGENTS.md + .github/copilot-instructions.md
- **Source:** https://developers.openai.com/codex/guides/agents-md
- **2nd source (Phase D):** https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions
- **Remediation:** Single sweep: replace 01KK974VMNC16ZAW7MW1NH3T3M -> 01KMM9ZA6SBZ7RKJZJTZS9VR4R and 01KK9751NZ4HM7VQM0AQ5WGME3 -> 01KMR5E36TP59PRQA8GQEWJVM1 across AGENTS.md, .codex/AGENTS.md, .cursorrules, .windsurf/rules/taskboard.md, .windsurf/workflows/kanban.md, .agents/rules/taskboard-sync.md, .agents/skills/kanban/SKILL.md, .github/copilot-instructions.md, .github/instructions/copilot.instructions.md, .github/skills/kanban/SKILL.md. Then add a CI grep gate (extend .claude/tools/dx-audit.sh) that fails if any of the known-stale IDs reappears in a provider file.

#### `Plugins / extens#1` — gh-aw lock files drifted from committed actions-lock.json pin (v0.53.1 vs v0.65.0)

- **Type / providers:** depth · GitHub Copilot CLI
- **Cited feature:** GitHub Agentic Workflows (gh-aw): author-edited .md compiled to a generated .lock.yml ('DO NOT EDIT … run gh aw compile'), with SHA-pinned actions tracked in .github/aw/actions-lock.json.
- **Source:** https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-cli-plugins
- **2nd source (Phase D):** https://github.github.com/gh-aw/reference/compilation-process/
- **Remediation:** Reconcile the pin: bump actions-lock.json to setup@v0.65.0 (sha a7066af5...) and the compiler_version metadata, OR recompile all 5 workflows against the recorded v0.53.1 pin so committed .lock.yml matches. Then add a CI guard (extend the changeset-gate-tests.yml pattern, or a new path-gated job on .github/workflows/*.md and .github/aw/**) that runs `gh aw compile` and fails on any diff between source and committed .lock.yml — closing this silent drift the same way Lockfile Sync closes package-lock drift. ~0.5 day.

#### `Settings & permi#1` — Claude permission allow-list is dead code and lives only in a gitignored local file

- **Type / providers:** depth · Claude Code
- **Cited feature:** Permission rules Tool(specifier) in allow/ask/deny evaluated deny->ask->allow, and the PermissionRequest hook event
- **Source:** https://code.claude.com/docs/en/permission-modes
- **2nd source (Phase D):** https://blog.vincentqiao.com/en/posts/claude-code-settings-permissions/
- **Remediation:** Either wire auto-approve-safe-commands.sh as a real PreToolUse/PermissionRequest hook in the committed settings.json, or (preferred, simpler) replace it with a committed permissions block in .claude/settings.json using allow/ask/deny Tool rules (e.g. allow Bash(npm run *), Bash(git status:*), deny Bash(rm -rf *)) so the safe-command policy is shared and actually enforced. Delete auto-approve-safe-commands.sh if superseded so it stops reading as live config. ~1-2 hours.
- **Resolution (#8690):** BOTH halves shipped — the off-limits constraint on `.claude/settings.json` was lifted by the user for this specific change. A committed `permissions` block adds the curated `allow` list plus `deny` guards `Edit(/.claude/settings.json)`, `Write(/.claude/settings.json)`, `Edit(/.codex/config.toml)`, `Write(/.codex/config.toml)` (project-root-anchored gitignore semantics, Edit+Write per file). `auto-approve-safe-commands.sh` was repaired rather than deleted: the doc's "PermissionRequest hook" was a misnomer — Claude Code has no `PermissionRequest` event, so the script is relabelled to its real `PreToolUse` (matcher `Bash`) event, now emits a `permissionDecision` of `allow` (known-safe) / `ask` (everything else) and **always exits 0** (the old blunt `exit 2` hard-block is gone), drops bare `npm exec` from the safe-list, and refuses to auto-approve any compound/piped/redirected/substituted command. Both behaviours are pinned by TDD bash suites under `.claude/hooks/__tests__/` (the hook: 33 assertions; the settings posture: 20 assertions), run by the path-gated `hook-tests` CI job.

#### `Single-source-of#1` — Copilot's two instruction files directly contradict each other on a core validation rule, breaking onboarding correctness

- **Type / providers:** depth · GitHub Copilot CLI
- **Cited feature:** memory / instruction files — Copilot CLI honors .github/copilot-instructions.md and *.instructions.md (.github/instructions/) with applyTo path scoping
- **Source:** https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions
- **2nd source (Phase D):** https://code.visualstudio.com/docs/agent-customization/custom-instructions
- **Remediation:** Reconcile the validation rule across the 3 Copilot files to the accurate statement ('newer chat handlers use Zod z.object().parse(); legacy handlers use typeof checks via parseArgs') and fix the command count to 350 (read from mcp-server/manifest/commands.json). Fold these into the generator from the prior gap so the count is templated, not hardcoded. Also enable the doc-sync-check.md agentic workflow to run on push (not just weekly) so contradictions surface in hours, not a week.

#### `Single-source-of#2` — dx-audit drift-checker ignores half the provider surfaces (.windsurf, .agents, .codex) it claims to govern

- **Type / providers:** depth · Codex CLI, Gemini CLI
- **Cited feature:** memory / instruction files — Codex AGENTS.md scope discovery; Gemini skills loaded from .gemini/skills/ (with .agents/skills alias)
- **Source:** https://developers.openai.com/codex/skills
- **2nd source (Phase D):** https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/skills.md
- **Remediation:** Extend IDE_CONFIGS in dx-audit.sh (line 36) to include .codex/AGENTS.md, .windsurf/rules/project.md, and .agents/rules/project.md, and add a check that greps all provider files for the now-stale literals (01KK974, 01KK9751, '--db', 'localhost:3010') and fails on any hit. ~20 LoC. Then make dx-audit a required CI step (it currently only runs via on-session-start.sh and the dx-guardian agent, neither of which gates PRs).

### P2 — Meaningful enhancements (26)

| ID | Type | Providers | Finding | Remediation (summary) |
|---|---|---|---|---|
| `Hooks & lifecycl#0` | depth | Codex CLI | Codex AGENTS.md falsely claims Codex has no lifecycle hooks; manual hook-running is now obsolete | Create .codex/hooks.json (or a [hooks] block in .codex/config.toml) mapping the four shared scripts to native Codex events: SessionStart->on… |
| `Hooks & lifecycl#1` | depth | GitHub Copilot CLI | Copilot postToolUse hook is wired to a Stop-semantics script (on-stop.sh), a lifecycle-event mismatch | In .github/hooks/hooks.json, move the on-stop.sh entry from postToolUse to the agentStop (Stop) event so worktree-safety-commit + GitHub syn… |
| `Hooks & lifecycl#2` | parity | GitHub Copilot CLI | Copilot under-uses available hook events vs the Claude surface (no PreToolUse gate, no SubagentStop review gate) | Add a preToolUse entry in .github/hooks/hooks.json (or a new .github/hooks/gates.json) that shells the existing block-main-commits.sh / chec… |
| `Hooks & lifecycl#3` | depth | Claude Code, Codex CLI, Gemini CLI, GitHub Copilot CLI | Only 2 of 48 hook scripts are tested, yet all four providers fire the untested scripts | Add co-located *.test.sh suites under .claude/hooks/__tests__/ for the four cross-provider scripts (on-session-start, on-prompt-submit, on-s… |
| `MCP server integ#0` | parity | Codex CLI | Codex CLI configures zero MCP servers despite full client support | Add a [mcp_servers.*] block to .codex/config.toml mirroring the 7 servers in .mcp.json. Since Codex uses stdio the same way, port each entry… |
| `MCP server integ#1` | parity | Gemini CLI | Gemini CLI wires no MCP servers despite native mcpServers support | Add an mcpServers object to .gemini/settings.json mirroring .mcp.json: { "mcpServers": { "context7": { "command": "npx", "args": ["-y","@ups… |
| `MCP server integ#2` | parity | GitHub Copilot CLI | GitHub Copilot interactive CLI has no MCP config for local contributors | Commit a repo-scoped Copilot MCP baseline (a documented mcp-config.json snippet in .github/ that contributors copy to ~/.copilot/mcp-config.… |
| `Memory / instruc#1` | parity | Codex CLI, Gemini CLI, GitHub Copilot CLI | No source-of-truth generator for cross-provider memory files — they are hand-mirrored and have already drifted | Build scripts/gen-provider-instructions.mjs that emits the cross-tool files from one source (e.g. a YAML manifest of live IDs/versions/count… |
| `Memory / instruc#3` | depth | GitHub Copilot CLI | Copilot instruction files contradict each other on the chat-handler validation rule (persistent-context conflict) | Reconcile all three Copilot files to the true rule ('newer handlers use Zod z.object().parse(); older handlers use typeof/regex via parseArg… |
| `Memory / instruc#4` | depth | Gemini CLI, Codex CLI, GitHub Copilot CLI | Gemini context.fileName loads CLAUDE.md but the 7 .claude/rules/*.md are referenced-not-loaded for every provider | Add @.claude/rules/gotchas.md (and the other 6) imports into AGENTS.md (shared, picked up by Gemini @-import and concatenated by Codex/Copil… |
| `Plan mode / plan#0` | depth | Claude Code | planner agent's spec-completeness Stop gate is silently disabled by a duplicate YAML 'hooks:' key | Merge the two 'hooks:' blocks in .claude/agents/planner.md into one mapping with both Stop and PreToolUse subkeys (a single 'hooks:' key con… |
| `Plan mode / plan#2` | parity | Codex CLI | Codex Goal mode (GA) / /plan not wired — Codex contributors get no plan-then-execute loop | Add a 'Planning' section to .codex/AGENTS.md instructing Codex contributors to run /plan before implementation and to use /goal for multi-st… |
| `Plugins / extens#0` | depth | Claude Code | Claude Code plugin manifest declares no components — bundling claim is hollow | Either (a) populate plugin.json with explicit component pointers — add a marketplace.json and reference the existing .claude/agents, .claude… |
| `Plugins / extens#2` | parity | Codex CLI | Codex plugin packaging unused — Codex contributors get no installable bundle | Package the Codex surface as a plugin: add a Codex plugin manifest under .codex/ that bundles the 3 skills plus an [hooks] block (or hooks.j… |
| `Plugins / extens#3` | parity | Gemini CLI | Gemini CLI extension framework unused — automation is hand-mirrored, not packaged | Author a gemini-extension.json that declares the 4 hooks (or moves them in), an mcpServers block mirroring the project MCP set (currently ze… |
| `Settings & permi#2` | depth | Claude Code | Claude Code uses none of the GA permission modes or Bash sandbox | Add a committed sandbox + permission-mode posture to .claude/settings.json: set defaultMode appropriately (e.g. plan to enforce Spec-First, … |
| `Settings & permi#3` | parity | Gemini CLI | Gemini CLI has no approval-mode or sandbox config despite GA support | Add to .gemini/settings.json: an approval-mode default (e.g. default or plan to mirror Spec-First), a tools.sandbox setting (docker or macOS… |
| `Single-source-of#3` | depth | Gemini CLI | Gemini's GEMINI.md undercounts its own skills (says 3, disk has 24), misleading contributor discovery | Replace the hardcoded 3-skill list in GEMINI.md with a generated table derived from ls .agents/skills/*/SKILL.md (templated by the generator… |
| `Skills & custom #0` | depth | Gemini CLI | Gemini CLI's first-class custom slash-command surface (.gemini/commands/*.toml) is entirely unused | Add .gemini/commands/sync-push.toml, sync-pull.toml, and kanban.toml. Each: `prompt = """..."""` wrapping the existing python3 .claude/hooks… |
| `Skills & custom #3` | parity | Codex CLI, Gemini CLI, GitHub Copilot CLI | Skills are not portable: 33 of Claude's 53 skills are absent from the cross-tool .agents/skills set used by Gemini/Codex/Copilot | Establish .claude/skills as the source of truth and add a generator (scripts/sync-skills.sh) that copies/symlinks the portable subset of SKI… |
| `Skills & custom #4` | parity | Codex CLI, Gemini CLI, GitHub Copilot CLI | No source-of-truth generator for skills/commands across providers; surfaces are hand-mirrored and already stale | Extend dx-audit.sh with a skills-parity check: diff the SKILL.md name sets across .claude/skills, .agents/skills, .github/skills (and .codex… |
| `Subagents / spec#0` | parity | Codex CLI | Codex CLI defines zero specialized subagents despite GA support | Create .codex/agents/ with 3-4 TOML subagents mirroring the highest-value Claude reviewers: rust-engine.toml, security-reviewer.toml, test-w… |
| `Subagents / spec#1` | parity | Gemini CLI | Gemini CLI defines zero specialized subagents despite GA support | Add .gemini/agents/ with 2-3 Markdown+frontmatter subagents (security-reviewer.md, test-writer.md, rust-engine.md) reusing the existing .git… |
| `Subagents / spec#2` | depth | GitHub Copilot CLI | Copilot agent definitions carry stale codebase facts (command count, test thresholds, conflicting validation rule) | Update the 4 .github/agents/*.md bodies: set thresholds to 70/60/65/72, command count to 350, reconcile the Zod-vs-parseArgs rule to 'newer … |
| `Subagents / spec#3` | depth | Claude Code | planner subagent's Stop hook is silently dropped by a duplicate YAML key | Merge the two 'hooks:' blocks in planner.md into a single mapping with both Stop and PreToolUse sub-keys (Claude Code hook frontmatter suppo… |
| `Subagents / spec#4` | depth | Codex CLI, Gemini CLI, GitHub Copilot CLI | No DX-audit/lint coverage for non-Claude subagent surfaces | Extend dx-audit.sh to also check .github/agents/ (Copilot) and, once created, .codex/agents/ + .gemini/agents/, cross-referencing agent coun… |

### P3 — Nice-to-have (8)

| ID | Type | Providers | Finding | Remediation (summary) |
|---|---|---|---|---|
| `MCP server integ#3` | depth | Claude Code | Claude MCP servers are stdio-only with no Tool Search alwaysLoad / HTTP transport tuning | Audit which MCP servers' tools are invoked every session (likely github + context7) and add an alwaysLoad entry for those in .mcp.json so To… |
| `Memory / instruc#2` | depth | Codex CLI | Codex instruction files do not use the documented AGENTS.override.md override mechanism | Demote .codex/AGENTS.md to a minimal .codex/AGENTS.override.md that contains ONLY the Codex-specific deltas (the manual hook-running steps, … |
| `Plan mode / plan#1` | depth | Claude Code | Claude Code native plan mode is unused; planning relies entirely on a convention stack | Add a documented plan-mode entry point: either set defaultMode for spec/architecture sessions in a dedicated settings profile, or add a /pla… |
| `Plan mode / plan#3` | parity | Gemini CLI | Gemini CLI default-on plan mode not configured; planning is gate-only | Document the Gemini /plan + --approval-mode=plan workflow in GEMINI.md (and the shared AGENTS.md) so the spec-first step maps to Gemini's na… |
| `Plan mode / plan#4` | parity | GitHub Copilot CLI | Copilot CLI plan mode and Plan agent unused; no Copilot planning surface | Add a short 'Plan mode' subsection to .github/copilot-instructions.md / copilot.instructions.md telling Copilot CLI contributors to enter /p… |
| `Plugins / extens#4` | parity | GitHub Copilot CLI | Copilot automation not packaged as a CLI plugin (loose agents/skills/hooks) | Optional: add a Copilot plugin manifest under .github/ referencing the existing .github/agents/* and .github/skills/*/SKILL.md, and consolid… |
| `Settings & permi#4` | parity | GitHub Copilot CLI | Copilot CLI has no trustedFolders or sandbox/tool-permission config in-repo | Add a committed repo-level Copilot tool/path posture — e.g. document a recommended ~/.copilot/config.json trustedFolders entry for the repo … |
| `Skills & custom #2` | depth | GitHub Copilot CLI | GitHub Copilot .prompt.md files are CLI-dead duplicates of the skills | Either (a) delete .github/prompts/*.prompt.md since .github/skills/ already covers sync-push/sync-pull for the CLU and coding agent, or (b) … |

## Recommended source-of-truth / sync strategy

The keystone remediation (resolves `SSoT#0` P0, `Memory#0`/`SSoT#1`/`SSoT#2` P1, and
P2 dups `Memory#1`/`Skills#4`/`Subagents#4`):

1. **One canonical fact source** — a single machine-readable file (e.g.
   `tools/agentic-sync/canonical.json`) holding the facts that must agree across all
   providers: live taskboard project/team IDs, MCP command count, test-coverage
   thresholds, build/quality commands, the validation convention, the WASM budget.
2. **Marker-injected generation** — a generator writes a shared block between sentinel
   markers (`<!-- AGENTIC-SYNC:START -->` … `END`) into each provider's instruction
   file (`AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`, …). Each file
   keeps its bespoke prose *outside* the markers, so generation is non-destructive but
   the shared facts can never drift or contradict.
3. **Drift-check CI gate** — `scripts/check-agentic-sync.sh` runs the generator in
   `--check` mode and fails the PR on any diff, modelled exactly on the existing
   `scripts/check-lockfile-sync.sh` gate (gated by a path filter, wired into the
   required `CI Success` aggregate). This makes drift impossible to merge silently —
   the same pattern that closed the recurring single-root-lockfile drift.
4. **dx-audit coverage** — extend `.claude/tools/dx-audit.sh` to lint *all* provider
   surfaces (`.windsurf`, `.codex`, `.gemini`, `.github`), not just the Claude ones
   (`SSoT#2`).

## Constraints & blocked remediations

Two files are **off-limits** this engagement (must not be modified or committed):
`.claude/settings.json` and `.codex/config.toml`. This bounds two findings:

- **`Settings#0` (P0)** — the divergence is real, but the *committed* config is the
  safe profile and the permissive state is a deliberate uncommitted working-tree edit.
  Only the in-bounds slice is actioned: a CI guard that fails if the **committed**
  `.codex/config.toml` ever sets `approval_policy="never"` together with
  `network_access=true`. The file itself is left untouched.
- **`Settings#1` (P1)** — ~~the preferred fix (a committed `permissions` block in
  `.claude/settings.json`) edits an off-limits file, so this ships as a **ticket only**
  with the blocker documented. The dead `auto-approve-safe-commands.sh` is *not*
  deleted unilaterally.~~ **Resolved in #8690:** the user explicitly lifted the
  off-limits constraint on `.claude/settings.json` for this change, so the preferred
  fix shipped in full (committed `permissions` block + repaired-and-wired hook). The
  `deny` rules in that block now gate the agent's own future edits to both off-limits
  files — the intended, user-chosen posture.

## Phase F implementation plan (PRs — never merged here)

| PR | Closes (findings) | Touches | Notes |
|---|---|---|---|
| **PR-1 source-of-truth generator + drift gate** | `SSoT#0` P0, `Memory#0` P1, `SSoT#1` P1, `SSoT#2` P1 (+ P2 dups) | `tools/agentic-sync/`, provider instruction files, `scripts/`, `ci.yml`, `.claude/tools/dx-audit.sh` | Keystone. TDD'd generator + `--check` drift gate. |
| **PR-2 gh-aw actions-lock realignment + guard** | `Plugins#1` P1 | `.github/aw/`, `scripts/`, `ci.yml` | Realign lock files to the committed pin; guard against re-drift. |
| **PR-3 Codex committed-config safety guard** | `Settings#0` P0 (in-bounds slice) | `scripts/`, `ci.yml` | Rejects a *committed* permissive Codex profile. Does **not** touch `.codex/config.toml`. |
| **PR-4 Claude permissions block + repaired auto-approve hook** | `Settings#1` P1 | `.claude/settings.json`, `.claude/hooks/auto-approve-safe-commands.sh`, `.claude/hooks/__tests__/` | #8690 — user lifted the off-limits constraint on `.claude/settings.json` for this change. Committed `permissions` block + TDD'd hook repair/wiring. |

**Recommended merge order:** PR-1 → PR-2 → PR-3 (PR-1 is the largest, foundational
diff; PR-2/PR-3 only append CI jobs and rebase cleanly on top). All `ci.yml` edits are
additive (new jobs + add to the `CI Success` aggregate) to avoid conflicts. P2/P3 are
filed as tracking tickets only.

## Completeness-critic note (what went unchecked / unverified)

- **`.codex/config.toml` working-tree edit** was read but, per the engagement
  constraint, not modified or further probed; the security assessment is on the
  *committed* state.
- **Cursor / Windsurf** were inventoried but not deep-dived (out of primary scope).
  The one Windsurf finding drafted (`SSoT#4`) was dropped as not-real on verification.
- **Provider GA/beta labelling** — several upstream docs carried no explicit GA tag;
  those statuses were inferred from "enabled-by-default"/changelog signals and are
  recorded as flagged unverifiable claims in the Phase B baseline (counts per provider
  above). Re-verify exact event/flag names against the live docs before relying on a
  specific identifier.
- **Gemini CLI consumer sunset (2026-06-18 → Antigravity CLI)** affects how long the
  Gemini-specific remediations stay relevant; subagents/skills are documented to carry
  over to Antigravity, but this was not independently load-tested.
- **Verification methodology** was uniform: one adversarial verifier per gap with a
  mandated distinct second source (not an N-vote panel), applied identically to all 42
  drafted gaps. A single verifier can still miss a subtle false-positive; the dropped
  gap shows the filter has teeth, but P2/P3 severities in particular carry more
  residual uncertainty than the P0/P1 set, which got the closest scrutiny.

---

_Generated from the Phase A–D assessment run (matrix complete across all 9
dimensions; 41/42 drafted gaps confirmed real via two-source adversarial
verification)._
