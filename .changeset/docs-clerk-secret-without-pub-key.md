---
"@spawnforge/docs": patch
---

Fail the docs build when Clerk is half-configured. `apps/docs`'s build-time
guard now rejects a present `CLERK_SECRET_KEY` with an absent
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, naming both variables — the state that
shipped docs.spawnforge.ai with sign-in silently dead and a "Missing
publishableKey" error on every request. The existing malformed-key check is
unchanged, and building with neither key set remains supported for local and CI
runs.
