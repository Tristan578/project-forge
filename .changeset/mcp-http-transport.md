---
"@project-forge/mcp-server": minor
---

Add Streamable HTTP transport (MCP spec 2025-11-25) alongside the existing stdio transport. Enable with `MCP_TRANSPORT=http` and a Bearer token in `MCP_HTTP_TOKEN`. Supports both stateful (SDK-managed sessions) and stateless (`MCP_HTTP_STATELESS=1`, fresh transport per request) modes, per-IP rate limiting (Upstash with in-memory fallback), an unauthenticated `/health` probe, and a 4MB request body cap.
