---
---

Agent tooling config only, so no package version changes. The repository's unauthenticated GitHub MCP server is renamed from `github` to `github-local` in `.mcp.json` and `.codex/config.toml`, and now declares `GITHUB_PERSONAL_ACCESS_TOKEN` explicitly. In a claude.ai/code cloud session it no longer takes the `github` name from the authenticated GitHub server, so issue and PR creation through `mcp__github__*` works again (#10389).
