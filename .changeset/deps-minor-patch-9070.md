---
"web": patch
---

chore(deps): bump npm minor-and-patch group (25 updates, #9070)

Routine minor/patch dependency group update. Runtime deps in `web`: `@ai-sdk/anthropic` 4.0.21→4.0.26, `@ai-sdk/gateway` 4.0.28→4.0.35, `@ai-sdk/mcp` 2.0.16→2.0.21, `@ai-sdk/react` 4.0.40→4.0.49, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` 3.1096→3.1101, `@clerk/nextjs` 7.6.1→7.6.4, `@sentry/nextjs` 10.68.0→10.69.0, `@upstash/redis` 1.38.0→1.38.1, `acorn` 8.17.0→8.18.0, `lucide-react` 1.27.0→1.28.0, `posthog-js` 1.407.3→1.409.5, `stripe` 22.3.2→22.4.0. Tooling/dev deps: `@playwright/test` 1.62.0→1.62.1, `jsdom` 30.0.0→30.0.1, `portless` 0.15.4→0.15.5, `@types/react` 19.2.17→19.2.18, `@types/react-dom` →19.2.4, `turbo` 2.10.7→2.10.8 (root), `vite` 8.1.5→8.2.0 + `@vitejs/plugin-react` 6.0.4→6.0.5 in `apps/design`, `fumadocs-core`/`fumadocs-ui` 16.13.0→16.14.0 in `apps/docs`.

Manual fix on top of the Dependabot bump: stripe-node 22.4.0 rolls its pinned `ApiVersion` literal from `2026-06-24.dahlia` to `2026-07-29.dahlia`, and the SDK types reject any other value — so the hardcoded string had to move in lockstep across `web/src/lib/billing/stripe-client.ts` plus the three billing route tests that assert it (`status`, `portal`, `checkout`), or `tsc --noEmit` fails and cascades into every build- and E2E-dependent job. The `invoice.parent.subscription_details.subscription` / top-level `invoice.subscription` dual read in the Stripe webhook route is deliberately unchanged: the Dashboard webhook endpoint carries its own API version, so both shapes must still be read. Verified unused across `web/src` and `mcp-server/src`: the only two removals in 22.4.0 (`proof_of_registration`, `dynamic_tax_rates`).
