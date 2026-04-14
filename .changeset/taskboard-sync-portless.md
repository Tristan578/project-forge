---
"web": patch
---

Fix GitHub project sync hook: route all taskboard traffic through Portless HTTPS (urllib's 302 downgrade was silently turning POST into GET), accept legacy project IDs in the import filter, and fall back to the configured team when a parsed `teamId` points at a stale team.
