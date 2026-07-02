---
"web": patch
---

Upgrade the Vercel AI SDK stack to v7 as a single coordinated major bump: `ai` 6→7, `@ai-sdk/mcp` 1→2, plus an explicit `@ai-sdk/provider-utils` ^5 pin (ending the dual-versioning that previously left it a phantom transitive dep). `@ai-sdk/anthropic`, `@ai-sdk/gateway`, and `@ai-sdk/react` remain on their v4 lines, which are the versions paired with `ai@7`. `@sentry/nextjs` stays on ^10.62.0 (#8855).

No application code changed — the migration is a version bump plus a root-lockfile relock. The v7 hyphenated `UIMessageChunk` chat SSE protocol is unchanged from v6, so the streaming contract test passes unmodified and no persisted chat data is affected. Sentry AI-generation spans keep emitting: v7 only stopped building OpenTelemetry spans itself, but still publishes to `diagnostics_channel` when `experimental_telemetry.isEnabled` is set, and `@sentry/nextjs@10.62.0` consumes that channel via its version-agnostic vercel-ai subscriber — so `@ai-sdk/otel` is deliberately **not** added and the four `experimental_telemetry` call sites are unchanged. Node 24 (already pinned) satisfies v7's Node 22+/ESM-only requirement.
