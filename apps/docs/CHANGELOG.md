# @spawnforge/docs

## 0.2.0

### Minor Changes

- [#8437](https://github.com/Tristan578/project-forge/pull/8437) [`c4c2454`](https://github.com/Tristan578/project-forge/commit/c4c2454bd547c956b2a2376115a971828adc1342) Thanks [@Tristan578](https://github.com/Tristan578)! - Make MCP reference, API docs, getting started guides, and homepage publicly accessible without authentication for SEO/GEO discoverability

- [#8446](https://github.com/Tristan578/project-forge/pull/8446) [`0a4a2eb`](https://github.com/Tristan578/project-forge/commit/0a4a2eb6c9a6dc250f0219b098c4808f871352a6) Thanks [@Tristan578](https://github.com/Tristan578)! - Add auto-generated sitemap from MDX content (284 pages) and proper SEO metadata to docs site layout

### Patch Changes

- [#9393](https://github.com/Tristan578/project-forge/pull/9393) [`90f7288`](https://github.com/Tristan578/project-forge/commit/90f7288c7198c901df5ad70f01aa26dc24b8f4f6) Thanks [@Tristan578](https://github.com/Tristan578)! - The docs site now participates in changesets versioning. It was on the `ignore`
  list while its changesets kept targeting it, so `changeset version` had nothing
  to apply and the release PR was generated with an empty diff — the changesets
  accumulated on `main` instead of being consumed. Un-ignoring the package
  required giving it the `version` field changesets needs, which every other
  versioned workspace package already had.

- [#9384](https://github.com/Tristan578/project-forge/pull/9384) [`10dddf9`](https://github.com/Tristan578/project-forge/commit/10dddf9c90ddeaa1b542cf2706c96298a0993a0c) Thanks [@Tristan578](https://github.com/Tristan578)! - The documentation site starts again in local development without Clerk keys. Its
  root layout wrapped the page in Clerk's provider unconditionally, which used to
  be harmless — a missing key quietly took Clerk's keyless path. The current Clerk
  release turns that same path into a hard error, so `npm run dev` failed outright
  for anyone who had not set up Clerk locally. The layout now checks for a
  well-formed key first, exactly as the main app has always done.
  
  The `/sign-in` route is covered too. It is public, and it renders Clerk's sign-in
  widget, which needs the provider the layout now skips — so guarding the layout
  alone would have moved the failure to that one route instead of removing it. It
  now explains that authentication is not configured rather than erroring.

- [#9461](https://github.com/Tristan578/project-forge/pull/9461) [`9376a60`](https://github.com/Tristan578/project-forge/commit/9376a60740d6e6373f93a43ff4c1d523217c591e) Thanks [@Tristan578](https://github.com/Tristan578)! - Bump Next.js from 16.3.2 to 16.3.3 to pick up the fix for GHSA-2xp9-vwfh-vxw4 (arbitrary code execution via the AVIF path in Image Optimization). `eslint-config-next` and `@next/bundle-analyzer` move in lockstep so the three stay on one Next release.
