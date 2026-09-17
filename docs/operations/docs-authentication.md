# Docs authentication behavior

Public docs routes remain available when Clerk middleware fails. Protected routes return HTTP 503 with a fixed error and Cache-Control: no-store; the proxy never forwards those requests. Logs use the fixed docs-auth middleware_unavailable identifier and omit provider exception payloads.

Production requires working Clerk configuration for protected access. An absent server key denies protected requests even if both keys were omitted at build time. Local development and unit-test environments may omit both keys for unrestricted local access. CI production builds can still smoke-test the public routes without Clerk.

The spawnforge-docs Vercel project must have the publishable key for the same Clerk instance as its server key on Production and Preview. Verify the sign-in UI in a browser and sample runtime logs after deployment; a successful build alone does not prove sign-in works.
