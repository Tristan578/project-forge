---
"spawnforge": patch
---

Bump npm `overrides` pins to clear 10 medium-severity Dependabot alerts:

- `dompurify` → `>=3.4.1` (covers 8 XSS bypass alerts; was `>=3.3.2`)
- `uuid` → `>=14.0.0` (transitive via svix/Storybook; missing buffer bounds check in v3/v5/v6)
- `fast-xml-parser` → `>=5.7.2` (transitive via @aws-sdk/client-s3; CDATA injection)

Also pins `stripe` at `~22.0.1` to preserve the existing `2026-03-25.dahlia` API version (avoids accidental minor 22.1.0 bump that ships a newer required API version), and adds `ajv@^6.14.0` as an explicit `web` devDep so `contracts.test.ts` no longer relies on incidental hoisting of a transitive ESLint ajv.

Test infra fixes carried in this PR (required to keep CI green after the lockfile regen and to clear pre-existing nightly failures):

- Add `vitest@^4.1.4` to the root devDeps so `@testing-library/jest-dom` (which lives at root and does `import "vitest"`) resolves after the clean install.
- Add a `next/router` resolve alias + `server.deps.inline: [/@sentry\/nextjs/]` to `web/vitest.config.jsdom.ts`, because `@sentry/nextjs` 10.50 ships `import "next/router"` as a bare specifier without an extension which vitest's strict ESM resolver rejects.
- Add a `"development"` export condition to `@spawnforge/ui` pointing at TS source, and configure jsdom vitest to honor it. Lets `EditorLayout.test.tsx` and `AppearanceTab.test.tsx` run in clean checkouts where `packages/ui/dist/` has not been built (closes the recurring nightly failures tracked in #8479, #8469, #8465).
- Add `storybook@^8.6`, `@storybook/react@^8.6`, and `@storybook/react-vite@^8.6` to the root devDeps. After the lockfile regen, `storybook` was hoisted to root but `@storybook/react-vite` was kept at `apps/design/node_modules/`, so `storybook/dist/proxy.cjs` could no longer resolve `@storybook/react-vite/preset` (`SB_CORE-SERVER_0002 CriticalPresetLoadError`). This broke the Design Internal Gate, Chromatic Visual Regression, and Storybook Internal Leak Gate jobs. Pinning the framework packages at root forces consistent hoisting.
