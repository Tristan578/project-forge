---
name: cycle
description: Runs the standard Plan -> Build -> Verify loop. usage: /cycle [task]
---
# The Development Loop

1. **Plan:** Invoke the `planner` skill to draft a spec for: {{input}}
   - STOP and await user approval.

2. **Build:** Once approved, invoke the `builder` skill to implement it.

3. **Verify:** Run the `arch-validator` skill to ensure safety.

4. **Update Context:** After verification passes, update project context files:
   - If new pitfalls/API quirks were discovered during build, add them to the relevant `.claude/rules/*.md` file
   - If a new phase was completed, update the Phase Roadmap in `.claude/CLAUDE.md`
   - If MCP commands were added/removed, update the count in `MEMORY.md` and `CLAUDE.md`
   - If new ECS components or libraries were added, update `rules/file-map.md` and `rules/bevy-api.md` or `rules/library-apis.md`
   - If new EntitySnapshot fields were added, update `rules/entity-snapshot.md`
   - Promote any temporary learnings from `MEMORY.md` "Session Learnings" into the appropriate rules file
