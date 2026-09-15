---
"web": minor
---

Route image and embedding key resolution through the Vercel AI Gateway. `resolveApiKey` now resolves `AI_GATEWAY_API_KEY` for gateway-routed capabilities (image, embedding) instead of a dedicated `PLATFORM_OPENAI_KEY`, via a single `isGatewayRoutedCapability` predicate reading `GATEWAY_CAPABILITIES` — the same list the platform-generation verify script and the `vercel-gateway` backend already read, so the resolver and verifier cannot disagree about which capabilities the gateway owns. Bring-your-own-key precedence, tier gating, token accounting, and the circuit breaker are unchanged; the gateway route never falls back to a direct provider key. Operators can now serve image and embedding generation with one credential (`AI_GATEWAY_API_KEY`) and leave `PLATFORM_OPENAI_KEY` unset for those two.
