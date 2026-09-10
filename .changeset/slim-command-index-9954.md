---
"web": patch
---

Stop shipping the whole MCP command manifest to the browser (#9954).

`web/src/lib/mcp/bridgeAllowlist.ts` decides which manifest commands a remote MCP agent may drive inside the editor tab. It needs three short strings per command — `name`, `category`, `requiredScope` — and it was importing the entire manifest to get them, so all 354 commands' descriptions and JSON parameter schemas travelled to every browser that opened the editor: 344 KB of JSON, and a 205 KB chunk after minification, to answer a question about three fields.

There is now a generated projection, `web/src/data/commandIndex.json` (40 KB), carrying exactly those three fields and nothing else. `npm run generate:command-index` rewrites it from the canonical `mcp-server/manifest/commands.json`, and the Docs Internal Gate fails when the committed index is not that projection — including when it carries an extra field, because "just one more field" is how the 344 KB comes back. Swapping the source of an allowlist is not cosmetic, so the equivalence is asserted directly: every command in the canonical manifest gets the same bridge verdict it did before.

This also unblocks the `Next.js Production Build` gate, which `main` had been failing on its own by 120 bytes.
