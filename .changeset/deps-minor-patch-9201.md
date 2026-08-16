---
"web": patch
---

Bump the npm minor-and-patch group (29 packages, including next 16.2.12 → 16.3.0).

next 16.3.0 adds `@next/next/no-location-assign-relative-destination`, which the
repo's `--max-warnings 0` policy turns into a build failure. The token-depleted
modal now soft-navigates with `useRouter().push` instead of assigning
`window.location.href` — a location assignment is a full document navigation, so
it was tearing down the WASM engine and every unsaved store slice on the way to
a billing page the user is expected to come straight back from.

The editor error boundary keeps its hard navigation, with the rule disabled on
that line and the reason recorded: it runs with `hasError` latched, so a soft
push would carry the same wedged engine and stores onto the next screen instead
of clearing them.
