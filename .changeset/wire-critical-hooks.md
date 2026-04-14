---
"web": patch
---

Wire 5 critical automation hooks into settings.json: builder-quality-gate, review-quality-gate, worktree-safety-commit (Stop), cargo-check-wasm (PostToolUse), reject-incomplete-review (SubagentStop). Fix check-arch.sh file permissions.
