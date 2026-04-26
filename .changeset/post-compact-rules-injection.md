---
"spawnforge": patch
---

Add `PostCompact` hook (`.claude/hooks/inject-post-compact.sh`) that re-emits every file under `.claude/rules/` so project rules survive auto-compaction. Claude Code only loads `CLAUDE.md` and `.claude/CLAUDE.md` on `SessionStart`; long sessions (>4hr on the main agent) lose them after compaction, causing agents to drift into deprecated patterns mid-session. The hook runs in ~30ms (well under the 5s timeout), wraps each rules file in `--- BEGIN <path> ---` / `--- END <path> ---` delimiters, and runs alongside the existing `restore-context-hints.sh`. Documented under "Long-Session Rule Persistence" in `.claude/rules/agent-operations.md`.
