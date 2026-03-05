---
description: Runs the standard Plan -> Build -> Verify loop. Usage /cycle [task]
---

# The Development Loop

Runs the full Plan → Build → Verify cycle for a task.

## Steps

1. **Plan:** Invoke the `/planner` workflow to draft a spec for the user's task.
   - STOP and await user approval of the spec.

2. **Build:** Once approved, invoke the `/builder` workflow to implement the spec.

3. **Verify:** Run the `/test` workflow to ensure nothing is broken.

4. **Validate Architecture:**
// turbo
```bash
grep -rn 'use web_sys\|use js_sys\|use wasm_bindgen' engine/src/core/ && echo "FAIL: bridge isolation violated" || echo "PASS: bridge isolation OK"
```

5. **Update Context:** After verification passes, update project context files:
   - If new pitfalls/API quirks were discovered, add them to `.windsurf/rules/`
   - If MCP commands were added/removed, update the count in copilot instructions
   - If new ECS components or libraries were added, update `rules/bevy-api.md`
   - Summarize all changes to the user
