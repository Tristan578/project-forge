---
"web": patch
"@project-forge/mcp-server": patch
---

Update fast-uri to 3.1.8, a security release that fixes inconsistent host case normalization via percent-encoded octets (GHSA-hrr3-gc8f-f4qj, medium severity). fast-uri is a dependency of the ajv JSON Schema validator: the MCP server gets it through the MCP SDK, and the editor gets it through ajv in the build tooling (the Sentry webpack plugin) and in its own test tooling.
