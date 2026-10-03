---
"@project-forge/mcp-server": patch
---

Update ip-address to 10.7.3, which collects the bug-fix and input-validation releases since 10.4.0 (for example, rejecting over-long in-addr.arpa names before parsing them). The MCP server pulls it in only through the MCP SDK's express-rate-limit dependency.
