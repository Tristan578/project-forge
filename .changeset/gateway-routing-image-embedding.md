---
"web": minor
---

Prepare image and embedding platform credential resolution for the Vercel AI Gateway.

`createGenerationHandler` now forwards its server-derived capability to `resolveApiKey`. For image and embedding, the resolver selects `AI_GATEWAY_API_KEY` without falling back to `PLATFORM_OPENAI_KEY`. On Vercel it returns an empty-key OIDC sentinel. Availability gates report this credential readiness; they do not prove a provider request succeeds. Existing stored BYOK credentials retain precedence, and tier gating, token accounting and circuit-breaker provider attribution remain unchanged.

This change makes no image or embedding upstream request. A consumer must pair the selected credential with the gateway endpoint and model adapter; an OIDC-aware SDK must handle the sentinel. The actual image consumer and transport verification remain tracked in #9818. Settings supports Anthropic, Meshy, Hyper3D and ElevenLabs keys; it has no OpenAI key option.

`/api/chat` retains its existing backend routing. Localization and pacing always use direct Anthropic credentials, even when a gateway key is present. DALL-E sprites and other existing direct-provider clients keep their current credentials.
