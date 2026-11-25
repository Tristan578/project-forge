---
"web": patch
---

Game localization and pacing suggestions now run through the Vercel AI Gateway whenever it is configured (an `AI_GATEWAY_API_KEY`, or Vercel OIDC on a Vercel deployment), the same as editor chat. A deployment that runs on the gateway no longer needs a separate `ANTHROPIC_API_KEY` for these two features. Deployments without the gateway keep using `ANTHROPIC_API_KEY` exactly as before, and a user's own Anthropic key is still sent straight to Anthropic. Token charges are unchanged.

The gateway's fast model is now named `anthropic/claude-haiku-4.5`, the spelling the live Gateway catalog lists, instead of `anthropic/claude-haiku-4-5`, which it does not. The same fix applies to the legacy `claude-sonnet-4-6` and `claude-opus-4-8` gateway mappings. This affects the fast model on every gateway path, including the last step of editor chat's model fallback chain.
