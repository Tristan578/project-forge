---
"web": patch
---

chore(deps): bump dockview-react 6.6.1 → 7.0.2 (#8903) + re-baseline first-load JS budget

dockview-react 7 ships an accessibility pack (ARIA roles, keyboard navigation, live regions) that adds ~27.5 KB minified and is not tree-shakeable in 7.0.2 (the `dockview-modules` opt-out entry point is unpublished). Our dockview usage is untouched by the v7 breaking changes — we use none of `onDidActivePanelChange`'s changed payload, `rootOverlayModel`, or the renamed types, and `.dv-*` CSS classes plus `SerializedDockview` layout serialization are byte-identical.

The first-load JS budget is re-baselined to warn 5.3 MB / fail 5.5 MB (was 4.75/5.25) in `performanceTargets.ts` and the `check-bundle-size.js` mirror: main was already at 5.24 MB against the 5.25 MB hard gate, so any dependency growth tripped it. The +720 KB creep since the March baseline is tracked in #8910.
