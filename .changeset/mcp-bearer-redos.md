---
"@project-forge/mcp-server": patch
---

Replace the bearer-token regex in the MCP HTTP transport with a safe slice/trim parser. The previous `/^Bearer\s+(.+)$/i` pattern was a polynomial-ReDoS vector (CodeQL js/polynomial-redos #59) against attacker-controlled `Authorization` headers with long whitespace runs. The new parser runs in linear time.
