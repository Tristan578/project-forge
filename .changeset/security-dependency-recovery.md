---
"web": patch
"@spawnforge/ui": patch
"@project-forge/mcp-server": patch
---

Update vulnerable runtime and development dependencies, including Next.js, DOMPurify, Undici, Hono, Vite, Storybook and Vitest, to patched releases. Refresh transitive dependency resolutions and enforce patched minimum versions for security overrides without weakening audit gates.

Replace the type-only Vercel configuration dependency with a narrowly typed local deployment contract to remove its unpatched Zod v3 subtree. Deployment values and pre-install evaluation behavior remain unchanged and are regression-tested.

Keep Monaco's existing editor version anchored at the workspace root so npm applies the patched DOMPurify override to its nested dependency. Align Playwright's shared types and remove the retired Next.js scroll-handler option so the security update can pass the unchanged type/build gates.

Anchor the existing PGlite test database at the workspace root so hoisted Drizzle can resolve its optional peer during real database tests.

Patch the independent engine CDN toolchain's Undici override and lockfile to 7.30.1. Remove the obsolete braces advisory waiver following its upstream withdrawal; no new audit exclusions are introduced.
