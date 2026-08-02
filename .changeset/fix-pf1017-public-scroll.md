---
"web": patch
---

fix(web): restore scrolling on every public page (PF-1017, #9037)

Two independent defects each removed scrolling from every logged-out page, and
both failed silently — `window.scrollTo()` kept working, so nothing threw and
no automated check noticed.

- `globals.css` set `body { overflow: hidden }`. With `html` at `overflow:
  visible`, an overflow on `body` propagates to the VIEWPORT rather than
  clipping the body box, so the scrollbar and wheel/trackpad input died
  document-wide. The rule was load-bearing for the editor only, so it moves to
  a new `<ViewportLock>` applied at the `/editor` and `/dev` route segments
  instead of globally. `ViewportLock` is a static `h-dvh overflow-hidden`
  box, deliberately not `position: fixed` — a fixed element establishes a
  stacking context and would re-scope every `z-index` inside the editor
  relative to body-level portals (toasts, dialogs). It uses `h-dvh` rather
  than `h-screen` because `100vh` is the *large* viewport on mobile browsers,
  so a `100vh` box would overflow the visual viewport by the browser-chrome
  height and make the editor document-scrollable — something the old global
  rule had been masking. `EditorLayout`'s two roots move to `h-dvh` to match.
- `app/(marketing)/page.tsx` and `app/page.tsx` both resolved to `/`. Next.js
  compiled both and `/page` won, so the route group's layout — which held the
  only scroll wrapper — never wrapped anything. The landing page moves to
  `components/marketing/LandingPage.tsx` and the dead `(marketing)` group is
  removed, leaving exactly one file routed to `/`.

`web/src/app/__tests__/public-scroll.test.ts` adds structural guards for both
defects plus the editor's viewport lock. The assertions are structural because
the failure mode is: the rendered markup is correct in jsdom, which has no
viewport to clip. The guards cover every `html`/`body` rule in `globals.css` and
in the `@import`ed `@spawnforge/ui` token sheet, the `<body className>` in the
root layout, and every `page.*` under `app/` at any depth — failing on any URL
path claimed twice, not just `/`.

Those CSS guards walk brace depth rather than matching line-anchored regexes, so
a rule nested inside `@media (max-width: …)` is caught too — a media query gates
the cascade, it does not suppress it, so a nested `body { overflow: hidden }`
reintroduces the bug on mobile while a top-level-only guard stays green. The
extractor is itself pinned against a synthetic stylesheet, which is what guards
the token sheet: that file legitimately has no `html`/`body` rules today, so
"found more than zero rules in every real file" is not an assertion that can be
made there.

`web/e2e/tests/mobile-viewport.spec.ts` gains a document-scroll containment
assertion at both emulated mobile viewports. Chromium has no retracting URL bar,
so it cannot reproduce the mobile-Safari large-viewport case — it is a tripwire
for the general "editor grew a document scrollbar" regression, where there was
previously none.

That directory also had no coverage in the local workspace gate: `src/app/__tests__`
matched neither `vitest.config.node.ts` nor `vitest.config.jsdom.ts`, so five
suites ran only under the standalone `vitest.config.ts`. The node config's globs
now include it.
