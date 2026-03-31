# Developer Experience Standards

SpawnForge is built by humans AND AI agents working in parallel across 5+ IDE tools. These standards ensure every session — human or agent — starts productively.

## Definition of Quality (DoQ)

A feature meets quality standards when ALL of these pass:

| Dimension | Standard | Validation Command |
|-----------|----------|-------------------|
| Correctness | All acceptance criteria pass, all tests green | `bash .claude/tools/validate-all.sh` |
| AI Parity | Every UI action has MCP command + chat handler | `bash .claude/tools/validate-mcp.sh audit` |
| Undo/Redo | Every user-visible state change is undoable | Manual verification |
| Type Safety | Zero TypeScript errors, zero `any` types | `bash .claude/tools/validate-frontend.sh tsc` |
| Lint Clean | Zero ESLint warnings | `bash .claude/tools/validate-frontend.sh lint` |
| Architecture | Bridge isolation enforced, sandwich maintained | `bash .claude/tools/validate-rust.sh check` |
| Tests Exist | New functions have tests, coverage doesn't regress | `bash .claude/tools/validate-tests.sh coverage` |
| Docs Updated | Known-limitations, README, rules files current | `bash .claude/tools/validate-docs.sh` |
| Manifests Synced | MCP manifests identical in both locations | `bash .claude/tools/validate-mcp.sh sync` |

## Definition of Done (DoD)

A ticket can be moved to `done` only when:

1. **All DoQ dimensions pass** — no exceptions, no "we'll fix it later"
2. **Subtasks completed** — every implementation step toggled in the taskboard
3. **Acceptance criteria verified** — each Given/When/Then confirmed
4. **Context updated** — `.claude/rules/`, `MEMORY.md`, `CLAUDE.md` reflect any new patterns
5. **Cross-IDE configs current** — if skills or tools changed, all 4 IDE configs updated
6. **No orphaned artifacts** — no stale feature flags, no dead imports, no TODO comments without tickets

## Cross-IDE Consistency (4 configs that must stay in sync)

SpawnForge supports 5 IDE tools. When skills or tools change, update ALL of these:

| Config File | IDE | Key contents |
|-------------|-----|-------------|
| `.claude/CLAUDE.md` | Claude Code | Skills list, agents, hooks, rules |
| `.cursorrules` | Cursor | Referenced skills, tool paths, patterns |
| `GEMINI.md` | Gemini CLI | Same as .cursorrules format |
| `AGENTS.md` | OpenAI Codex CLI / Devin | Agent profiles, capabilities |
| `.github/copilot-instructions.md` | GitHub Copilot | Code style, patterns |

Run `bash .claude/tools/dx-audit.sh` after any skill or tool addition to check consistency.

## Feature Documentation Requirements

Every new feature MUST have these before DoD:

### For engine features (Rust)
- New ECS component: `engine/src/core/<component>.rs` has Rustdoc comments on the struct
- Bridge functions: comment explaining what JS sends and what Bevy expects
- Complex systems: inline comments on non-obvious logic

### For web features (TypeScript)
- Store slice: JSDoc on interface + key actions
- Chat handler: parameter types documented in `parseArgs()` call
- Inspector panel: tooltip text on every input field

### For MCP commands
- `commands.json` description is specific (ranges, units, side effects)
- Not just the command name restated: "set_material_color" → "Set the base color of a PBR material. Accepts hex (#RRGGBB) or CSS color names. Takes effect on next frame render."

### For public-facing changes
- `TESTING.md` updated with manual test cases
- `README.md` updated when: phases complete, MCP count changes, new libraries, build process changes

## New Contributor Onboarding Checklist

A new contributor (human or agent) should be able to:

1. Clone the repo and run `vercel env pull web/.env.local` to get env vars
2. Run `cd web && npm install && npm run dev` and reach the editor
3. Run `cd web && npx vitest run` and see all tests pass
4. Read `CLAUDE.md` and understand the architecture in 5 minutes
5. Pick up a `todo` ticket and find all context needed to start work

Validate the onboarding experience:
```bash
bash .claude/tools/dx-audit.sh onboard
```

## Script Health Requirements

All scripts in `.claude/tools/` must:
- Be executable (`chmod +x`)
- Exit 0 on a clean project state
- Exit non-zero with a clear error message on failure
- Support `bash <script> --help` or display usage on wrong args
- Not require environment variables that aren't documented

All hooks in `.claude/hooks/` must:
- Work on macOS (zsh), macOS (bash), and Linux (bash)
- Fail gracefully — hooks should not crash Claude Code sessions
- Avoid `set -e` at the top level for hooks triggered by agent actions (they should warn, not abort)

## Anti-Patterns That Hurt DX

| Pattern | Why It Hurts | Fix |
|---------|-------------|-----|
| Stale version refs in docs | Agent reads wrong API, ships bug | Update immediately when upgrading |
| Broken script paths in skills | Agent hits `not found`, wastes time | Run `dx-audit.sh` after any rename |
| Missing `CLAUDE.md` entry for new skill | New agent sessions don't know it exists | Add to Skills section after every skill creation |
| IDE config drift | Agents on different IDEs use different patterns | Sync all 4 configs after every skill change |
| Undocumented gotchas | Same mistake repeated by every agent | Add to `memory/project_lessons_learned.md` immediately |
| Ticket without user story or AC | Agent doesn't know what "done" looks like | Enforce template at ticket creation |

## When to Run Which Audit

| Trigger | Mode | Command |
|---------|------|---------|
| Session start | audit | `bash .claude/skills/developer-experience/scripts/run-dx-audit.sh` |
| Feature completed | dod | `bash .claude/tools/validate-all.sh` |
| New skill added | refresh | Update all 4 IDE configs manually |
| New contributor | onboard | `bash .claude/tools/dx-audit.sh onboard` |
| PR before merge | full | `bash .claude/tools/validate-all.sh` |
