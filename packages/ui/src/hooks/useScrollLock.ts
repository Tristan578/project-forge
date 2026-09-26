import { useEffect } from 'react';

// Module-level state, shared across every consumer of this hook. A refcount
// (not a boolean) is required because dialogs can stack: closing an inner
// dialog must not release the lock while an outer one is still open. The
// lock is applied only on the 0 -> 1 transition and released only on the
// 1 -> 0 transition, so `previousOverflow` -- the value that was on
// `document.documentElement` before the FIRST lock in the stack -- is
// captured once and restored once, regardless of how many dialogs opened
// or closed in between.
let lockCount = 0;
let previousOverflow: string | null = null;

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
 */
export function useScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;

    if (lockCount === 0) {
      previousOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
    }
    lockCount += 1;

    return () => {
      lockCount -= 1;
      if (lockCount <= 0) {
        lockCount = 0;
        document.documentElement.style.overflow = previousOverflow ?? '';
        previousOverflow = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `locked` is the only reactive input; the module-level counter is intentionally not a dependency.
  }, [locked]);
}
