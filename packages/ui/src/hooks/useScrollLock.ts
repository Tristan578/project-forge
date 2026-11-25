import { useEffect } from 'react';

// Module-level state, shared across every consumer of this hook. A refcount
// (not a boolean) is required because dialogs can stack: closing an inner
// dialog must not release the lock while an outer one is still open. The
// lock is applied only on the 0 -> 1 transition and released only on the
// 1 -> 0 transition, so the inline values that were on
// `document.documentElement` before the FIRST lock in the stack are captured
// once and restored once, regardless of how many dialogs opened or closed in
// between.
let lockCount = 0;
let previousOverflow: string | null = null;
let previousPaddingRight: string | null = null;

/**
 * Locks page scroll for as long as `locked` is true, ref-counted so stacked
 * modals compose correctly (PF-1032 / #9052).
 *
 * Sets `overflow` on `document.documentElement`, and deliberately never on
 * `body`. An always-on `body { overflow: hidden }` rule was the prior
 * (accidental) scroll lock for the whole app; PF-1017 (#9037) scoped it to
 * editor routes because setting it on `body` leaks into viewport/visual
 * viewport sizing on public pages. Reintroducing a `body`-targeted lock here
 * would reopen that exact bug.
 *
 * Hiding the root overflow also removes a classic (non-overlay) scrollbar,
 * which widens the layout and shifts the page content sideways. The width the
 * scrollbar occupied is measured before locking and added to the root's
 * `padding-right`, so the content stays where it was. Overlay scrollbars
 * (macOS, mobile) measure 0 and get no padding.
 *
 * The padding only moves IN-FLOW content. An element with `position: fixed`
 * anchored to the right edge (e.g. web's `CookieConsent` banner, `right-4`) is
 * positioned against the viewport, which widens when the scrollbar goes, so it
 * still shifts right by the scrollbar width while the lock is held. This hook
 * does not compensate for that.
 *
 * `document` is only touched inside the effect, so this is safe to import and
 * render on the server.
 */
export function useScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;

    if (lockCount === 0) {
      const root = document.documentElement;
      // Measured BEFORE hiding overflow: once hidden, the scrollbar is gone
      // and the gap reads 0. `clientWidth` excludes the scrollbar, so the
      // difference is exactly the width it occupies.
      const scrollbarWidth = window.innerWidth - root.clientWidth;

      previousOverflow = root.style.overflow;
      previousPaddingRight = root.style.paddingRight;
      root.style.overflow = 'hidden';

      // `root.clientWidth > 0` excludes environments without layout (jsdom,
      // a `display: none` root), where the subtraction is meaningless.
      if (scrollbarWidth > 0 && root.clientWidth > 0) {
        const computed = Number.parseFloat(
          window.getComputedStyle(root).paddingRight
        );
        const basePadding = Number.isFinite(computed) ? computed : 0;
        root.style.paddingRight = `${basePadding + scrollbarWidth}px`;
      }
    }
    lockCount += 1;

    return () => {
      lockCount -= 1;
      if (lockCount <= 0) {
        lockCount = 0;
        const root = document.documentElement;
        root.style.overflow = previousOverflow ?? '';
        root.style.paddingRight = previousPaddingRight ?? '';
        previousOverflow = null;
        previousPaddingRight = null;
      }
    };
  }, [locked]);
}
