---
"web": patch
---

Deployment configuration is now typed: the editor's Vercel settings moved from `vercel.json` to `vercel.ts`, so a mistyped or missing setting is caught before a deploy instead of quietly changing how the site is built. Nothing about the editor, published games, routes, headers or scheduled jobs changes.

Details for maintainers: every value the JSON declared is carried over verbatim — `framework: nextjs`, the `cd .. && npm ci && npm run build --workspace=packages/ui` install command, `npm run build`, the `.next` output directory, the `iad1` region, `git.deploymentEnabled: false`, and the `/api/cron/health-monitor` cron on `*/15 * * * *`. `web/vercel.json` is deleted, because Vercel reads exactly one project config file. A typo'd or removed property now fails `tsc --noEmit`, and `vercelConfig.test.ts` pins each value at runtime.

`@vercel/config` is added as a devDependency of `web`. Its only use is an `import type`, which is erased at compile time. That is required: the Vercel CLI compiles `vercel.ts` on the CD runner before `vercel deploy`, and the staging deploy job runs no `npm ci` first, so a value import would fail the deploy. `vercelConfig.test.ts` pins that every import stays type-only.

Its transitive `@vercel/routing-utils@6.6.0` pins an exact `path-to-regexp@6.1.0`, which carries GHSA-9wv6-86v2-598j (backtracking regular expressions, high). The root `package.json` gains a version-selector override, `"path-to-regexp@6.1.0": "6.3.0"`, listed before the repo-wide `"path-to-regexp": ">=8.4.0"` rule so it matches that exact-pinned edge first. It retires only that nested copy to the patched 6.x release (the same 6.3.0 routing-utils already ships as `path-to-regexp-updated`), without touching the repo-wide rule or the audit allowlist.

A scoped `"@vercel/routing-utils": { "path-to-regexp": ... }` form was rejected: npm 11.19 treats the resulting override subtree as incomparable with the existing `@eslint/eslintrc` scoped subtree, and because their rules for `path-to-regexp` do not intersect, the `uri-js` node both subtrees share reports INVALID (Lockfile Sync stage 1).

npm propagates overrides only along dependency edges, never through workspace links, so the same `@vercel/config` range is also declared in the root `package.json` devDependencies purely to carry the override into that subtree. Both declarations must stay on the same range.
