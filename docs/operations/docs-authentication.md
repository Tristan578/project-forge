# Docs authentication behavior

> **Last updated:** 2026-09-16

Public docs routes remain available when Clerk middleware fails. Protected routes return HTTP 503 with a fixed error and Cache-Control: no-store; the proxy never forwards those requests. Logs use the fixed docs-auth middleware_unavailable identifier and omit provider exception payloads.

Production requires working Clerk configuration for protected access. An absent server key denies protected requests even if both keys were omitted at build time. Local development and unit-test environments may omit both keys for unrestricted local access. CI production builds can still smoke-test the public routes without Clerk.

The spawnforge-docs Vercel project must have a matching publishable/server key pair in each environment. Production uses the production Clerk instance. Preview uses a separately scoped development instance pair: live keys are not suitable for vercel.app preview origins. Preserve the existing encrypted publishable key, sensitive server key and sign-in/sign-up URLs when updating scopes; never copy a development key into Production or log either secret.

Clerk production must allow the exact docs subdomain under spawnforge.ai. In the production instance Dashboard, add docs to the subdomain allowlist. A blank sign-in page with Frontend API HTTP 403 and an origin-subdomain rejection is an allowlist problem; a successful build or HTTP 200 HTML does not prove authentication works.

After a configuration change, redeploy each environment and open its sign-in page in a browser. Require a visible identifier input and no uncaught page errors, then sample deployment-scoped Clerk runtime logs. Keep Vercel Preview protection enabled and use a short-lived protected testing link rather than making the project public.

Verification on 2026-09-16: both configuration redeployments reached READY. Preview rendered the sign-in identifier form with HTTP 200 and no page errors. Production still rejected docs.spawnforge.ai in Clerk's subdomain allowlist; its browser acceptance remains open until the production Dashboard change is saved and retested. No Clerk runtime-log entries appeared in the sampled production deployment window. Configuration success and runtime-log silence do not clear the outstanding production browser failure.
