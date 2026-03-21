---
name: infra-services
description: Use when writing code that integrates with Vercel, Cloudflare R2, Neon/Drizzle, Upstash Redis, Clerk auth, Stripe billing, Sentry error tracking, PostHog analytics, or GitHub Actions. Provides correct import patterns, configuration gotchas, and common failure modes for each service. Trigger on service names, SDK imports, env var configuration, webhook handlers, rate limiting, or deployment pipeline changes.
---

<!-- pattern: Tool Wrapper -->

# Infrastructure Service Reference

SpawnForge integrates 8 third-party services. Each has specific patterns, gotchas, and failure modes that agents must follow. Load the relevant reference file for the service you're working with.

## Service Index

| Service | Reference File | Key Files in Codebase |
|---------|---------------|----------------------|
| Vercel | @.claude/skills/infra-services/references/vercel.md | @web/next.config.ts, @web/src/proxy.ts, @.github/workflows/cd.yml |
| Cloudflare R2 | @.claude/skills/infra-services/references/cloudflare-r2.md | @infra/engine-cdn/, asset upload routes |
| Neon + Drizzle | @.claude/skills/infra-services/references/neon-drizzle.md | @web/src/lib/db/ |
| Upstash Redis | @.claude/skills/infra-services/references/upstash.md | @web/src/lib/rateLimit/distributed.ts |
| Clerk | @.claude/skills/infra-services/references/clerk.md | @web/src/lib/auth/, @web/src/proxy.ts |
| Stripe | @.claude/skills/infra-services/references/stripe.md | @web/src/lib/billing/, webhook routes |
| Sentry | @.claude/skills/infra-services/references/sentry.md | @web/src/app/api/chat/route.ts |
| PostHog | @.claude/skills/infra-services/references/posthog.md | @web/src/lib/analytics/posthog.ts |

## How to Use

1. Identify which service(s) your change touches
2. Read the corresponding reference file(s) from `references/`
3. Follow the patterns and check the gotchas before writing code
4. Cross-reference with the infra-devops agent for deployment concerns

## Universal Rules

- **Never hardcode API keys** -- all keys come from environment variables
- **All external calls need error handling** -- services go down, APIs rate-limit
- **Test with mocks, not real services** -- vi.mock the SDK, not the HTTP calls
- **Env vars prefixed `NEXT_PUBLIC_`** are exposed to the browser -- only use for client-safe values
- **Webhook handlers must be idempotent** -- they can be delivered multiple times
