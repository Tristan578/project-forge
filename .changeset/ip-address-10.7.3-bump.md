---
"@project-forge/mcp-server": patch
---

Update ip-address from 10.4.0 to 10.7.3, which clears four moderate advisories: GHSA-rpw4-54j3-4h4q (`isLinkLocal()` matched only fe80::/64, not fe80::/10), GHSA-2vr4-cq9g-pvrc (the NAT64 local-use range was not classified), GHSA-j6r3-76f7-8jcv (subnet checks compared addresses of different families) and GHSA-h3mg-xc3c-68pw (the `Address6` parser built a diagnostic proportional to the input with no length bound). The 10.5–10.7 releases in between also add API (`isGlobal`, `offset`, `nextNetwork` and others) without removing any. The MCP server pulls ip-address in only through the MCP SDK's express-rate-limit dependency, which calls `new Address6()`, `is4()`/`to4()` and `networkForm()`. express-rate-limit is used only by the SDK's OAuth handlers, which the MCP server does not import, so this clears the audit advisories for the installed tree without changing what the server runs.
