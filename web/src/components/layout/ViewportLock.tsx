/**
 * Full-viewport scroll lock for surfaces that manage their own scroll regions.
 *
 * The editor fills the viewport exactly and scrolls internally (Dockview panels,
 * scene hierarchy, inspector), so the document must never gain a scrollbar.
 * That used to be enforced by `body { overflow: hidden }` in globals.css — but
 * an `overflow` on `body` propagates to the viewport, so it silently disabled
 * scrolling on every public marketing page too (PF-1017).
 *
 * Scoping the lock to a route segment fixes that. The wrapper is exactly `100vh`
 * with `overflow: hidden`, so the document has no overflow to scroll and the
 * clipping behaviour the editor relied on is preserved.
 *
 * Deliberately NOT `position: fixed`: a fixed element always establishes a new
 * stacking context, which would re-scope every `z-index` inside the editor
 * relative to body-level portals (toasts, dialogs). A static block box changes
 * no stacking behaviour.
 */
export function ViewportLock({ children }: { children: React.ReactNode }) {
  return <div className="h-screen overflow-hidden">{children}</div>;
}
