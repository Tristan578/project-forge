---
"web": minor
---

Route image and embedding platform key resolution through the Vercel AI Gateway.

`resolveApiKey` now resolves `AI_GATEWAY_API_KEY` (or, on a Vercel runtime, the OIDC-injected token) for the resolver-gateway capabilities `image` and `embedding` instead of `PLATFORM_OPENAI_KEY`, and never falls back to a direct provider key for them — the same routing the availability gates (`isCapabilityConfigured`, `/api/capabilities`) and the platform-generation verify script apply, so a green gate is always an environment the resolver can serve. Bring-your-own-key precedence, tier gating, token accounting, and the circuit breaker are unchanged.

`createGenerationHandler` forwards each route's capability to `resolveApiKey`, so every `/api/generate/*` route resolves the key its capability requires.

Operational requirement: after this release, the platform path for image and embedding generation requires `AI_GATEWAY_API_KEY` (or a Vercel OIDC runtime); `PLATFORM_OPENAI_KEY` no longer serves them. Set the gateway key before deploying, or those two capabilities report unavailable and 500 on use. A user's own OpenAI key added in Settings still works via bring-your-own-key.

Chat is unchanged: it remains gateway-served through `/api/chat`, but is NOT forced onto the gateway by the resolver, so `/api/generate/localize` and `/api/generate/pacing` keep resolving `ANTHROPIC_API_KEY` and a direct-Anthropic deployment is unaffected.
