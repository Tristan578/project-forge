import { type FocusEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { cn } from "../utils/cn";
import { SCROLL_REGION_ATTR, useDialogA11y } from "../hooks/useDialogA11y";
import { useScrollLock } from "../hooks/useScrollLock";
import { Z_INDEX } from "../tokens";
import { ScrollArea } from "./ScrollArea";

/**
 * Whether the scroll container's content is taller than its box, re-measured
 * whenever either the box (viewport resize) or the content (async content,
 * a phase change) resizes. Without `ResizeObserver` (jsdom, very old
 * engines) it measures once.
 *
 * While it overflows, the scroller is a focusable region (see `Dialog`). When
 * it stops overflowing (a resize, a rotation, content shrinking) that region
 * loses its `tabIndex`; if it held focus at that moment, the browser would drop
 * focus to `<body>`, outside the `aria-modal` dialog. So focus moves to
 * `focusFallbackRef` (the dialog container, `tabIndex={-1}`) first, before the
 * state change that removes the attribute.
 *
 * The reverse hand-off: when the region APPEARS while focus sits on that
 * container, focus moves into the region. This is what makes a control-less
 * dialog's initial focus land on its scroll region in a real browser.
 * `useDialogA11y` picks the initial focus target in a `requestAnimationFrame`,
 * and Chromium runs that frame callback BEFORE the first ResizeObserver
 * notification (measured, PR #10294 board round 3). So at that moment the region is
 * not focusable yet, there is nothing else to focus, and the container takes
 * focus; the region then becomes focusable a moment later and takes it over.
 * The same path returns focus to the region when content that shrank grows
 * back. It also runs if a click on non-interactive dialog text focused the
 * container (it is `tabIndex={-1}`) just before the content grew; focus then
 * moves one level in, to the region inside that same container.
 */
function useOverflowsVertically(
  scrollerRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  focusFallbackRef: RefObject<HTMLElement | null>,
  active: boolean
): boolean {
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!active || !scroller) return;
    const measure = () => {
      // 1px of slack absorbs sub-pixel rounding between the two integer reads.
      const next = scroller.scrollHeight - scroller.clientHeight > 1;
      if (!next && scroller.ownerDocument.activeElement === scroller) {
        focusFallbackRef.current?.focus();
      }
      setOverflows(next);
    };
    if (typeof ResizeObserver === "undefined") {
      measure();
      return () => setOverflows(false);
    }
    // A ResizeObserver reports every observed element once on observe(), so
    // this also takes the initial measurement.
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => {
      observer.disconnect();
      setOverflows(false);
    };
  }, [active, scrollerRef, contentRef, focusFallbackRef]);

  const regionActive = active && overflows;

  // Runs after the commit that gave the scroller its `tabIndex`, so the
  // region can actually take focus here (it could not inside `measure`).
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!regionActive || !scroller) return;
    const fallback = focusFallbackRef.current;
    if (fallback && scroller.ownerDocument.activeElement === fallback) {
      scroller.focus();
    }
  }, [regionActive, scrollerRef, focusFallbackRef]);

  return regionActive;
}

/**
 * Scrolls a control that took keyboard focus inside the Dialog body into the
 * body's visible area (`block: "nearest"`: no movement when it is already in
 * view). Browsers are meant to do this themselves, but WebKit did not reliably
 * do it for a Tab-focused link inside the body: in CI a Tab onto a link
 * 500-700px below the body's fold sometimes left it there (PR #10294 board round 5,
 * E2E Cross-Browser webkit). React's `onFocus` bubbles (it is `focusin`), so
 * one handler on the body covers every descendant.
 *
 * Keyboard focus only (`:focus-visible`). A pointer press focuses its button
 * on mousedown; scrolling then could move the button out from under the
 * pointer before mouseup, and the click would be lost. The body itself (the
 * focusable region) is the scrollport, so focusing it scrolls nothing.
 */
function revealFocusedDescendant(event: FocusEvent<HTMLDivElement>) {
  const target = event.target;
  if (target === event.currentTarget || !(target instanceof HTMLElement)) return;
  let visible = false;
  try {
    visible = target.matches(":focus-visible");
  } catch {
    // An engine without :focus-visible: leave scrolling to the browser.
  }
  // jsdom does not implement scrollIntoView.
  if (visible) target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  className,
}: DialogProps) {
  const { dialogProps, titleProps } = useDialogA11y({
    title,
    isOpen: open,
    onClose,
  });
  useScrollLock(open);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const bodyContentRef = useRef<HTMLDivElement | null>(null);
  const hasBody = Boolean(children);
  const bodyOverflows = useOverflowsVertically(
    bodyRef,
    bodyContentRef,
    dialogProps.ref,
    open && hasBody
  );

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        data-dialog-overlay
        className="fixed inset-0 bg-[color-mix(in_srgb,var(--sf-bg-app)_70%,transparent)] backdrop-blur-sm"
        style={{ zIndex: Z_INDEX.modals - 1 }}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Dialog panel */}
      <div
        {...dialogProps}
        tabIndex={-1}
        className={cn(
          "fixed",
          "w-full max-w-md",
          // dvh, not vh: on mobile `vh` is the toolbar-hidden height, so an
          // 85vh panel can run under the browser's visible URL bar.
          "max-h-[85dvh]",
          "rounded-[var(--sf-radius-xl)]",
          "border border-[var(--sf-border)]",
          "bg-[var(--sf-bg-surface)] text-[var(--sf-text)]",
          "shadow-[0_8px_32px_rgba(0,0,0,0.5),0_2px_8px_rgba(0,0,0,0.3)]",
          "flex flex-col",
          className
        )}
        style={{
          zIndex: Z_INDEX.modals,
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
        }}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-2">
          <h2 {...titleProps} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {description && (
            <p className="mt-1.5 text-sm text-[var(--sf-text-secondary)] leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {/* Body -- ScrollArea gives this its own scroll container (so tall
            content scrolls internally rather than growing the fixed panel
            past the viewport) and carries `[overscroll-behavior:contain]`,
            which stops a drag that hits the end of this list from chaining
            into the (locked) document behind it (PF-1032 / #9052 acceptance
            criterion 5).

            While the content overflows, the body is also a labelled,
            focusable region so a keyboard user can Tab to it and scroll it
            with the arrow keys (WCAG 2.1.1); a mouse wheel is otherwise the
            only way to reach the text below the fold. SCROLL_REGION_ATTR keeps
            initial focus on the first real control rather than this box.
            When nothing overflows it is a plain container and no extra Tab
            stop. Consumers should NOT nest a second bounded scroller inside
            this one: a box that scrolls inside a box that scrolls can carry
            its own content (and buttons) out of view. Nor should they pin
            controls inside it (`sticky`): a pinned row covers whatever scrolls
            under it, and keeping focus clear of it needs scroll padding that
            browsers do not honour alike (PR #10294 board rounds 3 and 4). Controls
            that must stay in view go in `actions`, below, which does not
            scroll. */}
        {hasBody && (
          <ScrollArea
            ref={bodyRef}
            data-dialog-body=""
            onFocus={revealFocusedDescendant}
            className="min-h-0 flex-1 px-6 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sf-accent)]"
            {...(bodyOverflows
              ? {
                  tabIndex: 0,
                  role: "region",
                  "aria-labelledby": titleProps.id,
                  [SCROLL_REGION_ATTR]: "",
                }
              : {})}
          >
            <div ref={bodyContentRef}>{children}</div>
          </ScrollArea>
        )}
        {/* Actions -- outside the body's scroll, so always in view and never
            covering the body's content. */}
        {actions && (
          <div data-dialog-actions="" className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--sf-border)] bg-[var(--sf-bg-app)]/30 rounded-b-[var(--sf-radius-xl)]">
            {actions}
          </div>
        )}
      </div>
    </>
  );
}

Dialog.displayName = "Dialog";
