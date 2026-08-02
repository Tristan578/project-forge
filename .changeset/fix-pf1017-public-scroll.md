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
  instead of globally. `ViewportLock` is a static `h-screen overflow-hidden`
  box, deliberately not `position: fixed` — a fixed element establishes a
  stacking context and would re-scope every `z-index` inside the editor
  relative to body-level portals (toasts, dialogs).
- `app/(marketing)/page.tsx` and `app/page.tsx` both resolved to `/`. Next.js
  compiled both and `/page` won, so the route group's layout — which held the
  only scroll wrapper — never wrapped anything. The landing page moves to
  `components/marketing/LandingPage.tsx` and the dead `(marketing)` group is
  removed, leaving exactly one file routed to `/`.

`web/src/app/__tests__/public-scroll.test.ts` adds structural guards for both
defects plus the editor's viewport lock. The assertions are structural because
the failure mode is: the rendered markup is correct in jsdom, which has no
viewport to clip.
