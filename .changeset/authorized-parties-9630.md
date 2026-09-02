---
"web": patch
---

Clerk session tokens are now checked against the deployment's own origins (`authorizedParties`, the `azp` claim) in both the app and the docs middleware, so a token minted for another Clerk-hosted origin is rejected instead of accepted. Vercel preview and branch origins are included so previews keep signing in.
