---
"web": patch
---

Bump `eslint-plugin-react-hooks` to 7.1.1 and fix the 20 violations it surfaces
(PF-DEP / #9385).

Three rules newly fire, and each has a distinct correct fix:

- `react-hooks/immutability` ("accessed before it is declared") — an effect
  reaching a loader declared further down the component body. Fixed by hoisting
  the loader into a `useCallback` above the effect, inlining it when it had a
  single caller, or (in `useGenerationPolling`) moving the effect below the
  function declarations it drives.
- `react-hooks/refs` — `HelpMenu` built its menu-item ref array from a
  render-time ref-callback factory that wrote to `ref.current` while rendering,
  and never cleared the array, so a closed-then-reopened menu could focus a
  detached node. Menu items are now read from the DOM in render order.
- `react-hooks/set-state-in-effect` — state derived from a prop or store value
  (`ContextMenu`, `HierarchySearch`, `TerrainInspector`, `AddEntityMenu`) moves
  to the prev-value-during-render pattern; `DialogueOverlay`'s typewriter now
  keeps only a reveal index in state and derives the text and done flag during
  render; `GamePlayer` reads `window.location.href` through
  `useSyncExternalStore` instead of a mount effect; and the fetch-on-mount
  callers drive their loader from an async IIFE inside the effect, which is the
  only shape the rule accepts for a named callee containing a `setState`.

`AddEntityMenu` and `ContextMenu` additionally gained `cancelAnimationFrame`
cleanup for their auto-focus frames, which previously leaked past unmount.

No rule was disabled or downgraded to make this pass.
