---
"web": patch
"@spawnforge/docs": patch
---

Fixed internal links that pointed at routes which do not exist.

In the editor, the "You're out of tokens" modal is intentionally non-dismissible, and two of its three exits 404'd: "Buy Token Pack" and "Use Your Own API Key" now open the Billing and API Keys tabs on `/settings` instead of the `/settings/billing` and `/settings/api-keys` pages that were never built. The low-token banner, the failed-payment banner and the locked-panel upgrade prompt pointed at the same missing billing page and now open the Billing tab too. Forking a game from the community gallery landed on a dead `/editor?project=…` URL and now opens the new project in the editor.

The 500 error page now offers a "Go Home" link alongside "Try Again" and "Back to Dashboard", so a signed-out visitor who hits an error has a recovery link that does not lead to a sign-in wall.

On the docs site, every category tile on the MCP command reference linked to a page that did not exist; `/mcp/<category>` is now a real page listing that category's commands with their parameters, scopes and token costs. The homepage no longer links to an API reference that has not shipped.
