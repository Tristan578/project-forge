---
"web": patch
"@project-forge/mcp-server": patch
"@spawnforge/ui": patch
---

Routine minor and patch refresh of 51 npm dependencies (Dependabot group), including React 19.3.1, Sentry 11.10.0, the AI SDK (ai 7.0.159 with its @ai-sdk providers), Clerk 7.9.23, the MCP SDK 1.32.2, Playwright 1.64.1, PGlite 0.5.14 and Storybook 10.6.5. Nothing in the editor, published games or the docs site looks or behaves differently.

Follow-up fixes so the bump passes CI: the lockfile now hoists Playwright and PGlite to the root again (Dependabot left two Playwright copies, which broke type-checking and `next build`, and left PGlite where drizzle-orm could not resolve it in the database tests). Sentry 11.10 adds an `mcp` data class that defaults on, so all three Sentry configs now opt out of it like every other class. MCP SDK 1.32 fixed the transport typing gap, so the two `as Transport` casts in the MCP server's HTTP transport and their pinning test are gone (#10278).
