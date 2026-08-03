/**
 * Full-viewport scroll lock for surfaces that manage their own scroll regions.
 *
 * The editor fills the viewport exactly and scrolls internally (Dockview panels,
 * scene hierarchy, inspector), so the document must never gain a scrollbar.
 * That used to be enforced by `body { overflow: hidden }` in globals.css — but
 * an `overflow` on `body` propagates to the viewport, so it silently disabled
 * scrolling on every public marketing page too (PF-1017).
 *
 * Scoping the lock to a route segment fixes that. The wrapper is exactly one
 * viewport tall with `overflow: hidden`, so the document has no overflow to
 * scroll and the clipping behaviour the editor relied on is preserved.
 *
 * `h-dvh`, not `h-screen`: on mobile Safari/Chrome `100vh` resolves to the LARGE
 * viewport (URL bar retracted), so a `100vh` box in normal flow overflows the
 * visual viewport by the browser-chrome height and the whole editor becomes
 * document-scrollable. The old global `body { overflow: hidden }` masked that;
 * nothing does now, so the lock must track the DYNAMIC viewport.
 *
 * Deliberately NOT `position: fixed`: a fixed element always establishes a new
 * stacking context, which would re-scope every `z-index` inside the editor
 * relative to body-level portals (toasts, dialogs). A static block box changes
 * no stacking behaviour.
 */
export function ViewportLock({ children }: { children: React.ReactNode }) {
  return <div className="h-dvh overflow-hidden">{children}</div>;
}
