---
"web": patch
---

chore(deps): bump npm minor-and-patch group (30 updates, #8964)

Routine minor/patch dependency group update. Runtime deps in `web`: `@ai-sdk/anthropic` 4.0.12→4.0.16, `@ai-sdk/gateway` 4.0.16→4.0.23, `@ai-sdk/mcp` 2.0.10→2.0.15, `@ai-sdk/provider-utils` 5.0.7→5.0.11, `@ai-sdk/react` 4.0.23→4.0.34, `ai` 7.0.22→7.0.31, `@anthropic-ai/sdk` 0.111.0→0.112.3, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` 3.1085→3.1090, `@clerk/nextjs` 7.5.17→7.5.20, `@sentry/nextjs` 10.65.0→10.67.0, `@upstash/qstash` 2.11.1→2.11.2, `lucide-react` 1.24→1.25, `posthog-js` 1.399.3→1.404.1, `stripe` 22.3.1→22.3.2 (ApiVersion literal unchanged — tsc gate green), `svix` 1.96.1→1.98.0, `ws` 8.21.0→8.21.1. Tooling/dev deps: Storybook 10.5.0→10.5.3, `vite` 8.1.4→8.1.5, Tailwind 4.3.2→4.3.3, `@changesets/cli` 2.31.0→2.31.1, `portless` 0.15.1→0.15.4, `fumadocs-core`/`fumadocs-ui` 16.11.4→16.11.5 in `apps/docs`.

Manual fix on top of the Dependabot bump: `@clerk/nextjs` 7.5.20 requires `@clerk/shared` ^4.25.5 (it imports `isAutoProxyDisabledFromEnvironment`, added after 4.23.0), but the root-override security floor `@clerk/shared: ^4.22.1` kept the lockfile's single hoisted copy at 4.23.0 — npm does not re-resolve an already-pinned transitive when only its override range changes, so the Turbopack build failed with a missing export while Lockfile Sync stayed green. Raised the override floor to `^4.25.5` and relocked the root lockfile on Node 24 (only the `@clerk/shared` version/resolved/integrity lines changed; regen verified byte-stable).
