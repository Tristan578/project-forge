'use client';

/**
 * ApprovalGateDialog — the inline approval prompt for one pipeline gate.
 *
 * Lives in its own module so the quick-start dialog can render the same gate
 * without a second copy of the markup. A quick-start run auto-approves
 * `gate_plan` ONLY, so `gate_assets` / `gate_final` still stop the run: whoever
 * started it has to be able to answer them from where they are standing.
 *
 * Every colour here is a `--sf-*` token, not a Tailwind palette shade. The
 * previous zinc/amber/green markup was rendered inside the token-themed
 * `@spawnforge/ui` Dialog, so on the light theme `text-amber-200` on
 * `bg-amber-950/30` inverted into near-invisible text — a WCAG AA failure that
 * only appeared on 6 of the 7 themes.
 */

import { useEffect, useLayoutEffect, useRef, type ReactNode, type Ref, type RefObject } from 'react';
import { Button, cn } from '@spawnforge/ui';
import type { ApprovalGate } from '@/lib/game-creation/types';

const ROW = 'rounded-[var(--sf-radius-sm)] bg-[var(--sf-bg-elevated)] px-2 py-1 text-xs text-[var(--sf-text-secondary)]';

/**
 * Space kept between the pinned action row and anything the browser scrolls
 * into view above it (a focused link, the discard prompt), on top of the
 * strip the row covers.
 */
export const PINNED_ROW_CLEARANCE_PX = 8;

/**
 * The scroll container a `sticky` descendant of `el` pins to: the nearest
 * ancestor whose `overflow-y` makes it one (`visible` and `clip` do not).
 */
function findScrollContainer(el: HTMLElement): HTMLElement | null {
  const view = el.ownerDocument.defaultView;
  if (!view) return null;
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = view.getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden' || overflowY === 'overlay') {
      return node;
    }
  }
  return null;
}

/**
 * In 'parent' mode, keeps the parent scroller's `scroll-padding-bottom` equal
 * to the strip the pinned row covers, plus PINNED_ROW_CLEARANCE_PX, while the
 * row is mounted, and restores the previous value on unmount.
 *
 * That strip is the row's height PLUS the scroller's own bottom padding: a
 * `sticky bottom-0` box pins to the scrollport's bottom edge inset by the
 * container's padding, not to the edge itself. (The Dialog body's `py-3` is
 * 12px. With the row height alone, "Keep plan" stopped 4px under the row in
 * Chromium: measured, PR #10294 round 4.)
 *
 * The row is `sticky bottom-0`, so it covers the bottom strip of the
 * scroller's visible area, and without this the browser counts that strip as
 * visible. Chromium scrolls a newly focused control only when its box lies
 * outside the scrollport, so Tab could land on "Keep plan" or "Buy tokens"
 * under the row (WCAG 2.4.11), and `scrollIntoView` would stop with its
 * target under it. Both honour the scroller's scroll padding. A scroll MARGIN
 * on the target is not part of Chromium's focus check (PR #10294 round 3,
 * measured), so it cannot do this job.
 *
 * The value is measured, not a constant, because the row's height changes
 * with its summary line, with wrapping, and with the viewport: below the `sm`
 * breakpoint a small button keeps a 44px touch target, above it 32px.
 */
function usePinnedRowScrollPadding(rowRef: RefObject<HTMLElement | null>, active: boolean) {
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!active || !row) return undefined;
    const scroller = findScrollContainer(row);
    if (!scroller) return undefined;
    const previous = scroller.style.scrollPaddingBottom;
    const view = scroller.ownerDocument.defaultView;
    const apply = () => {
      const height = row.getBoundingClientRect().height;
      const padding = Number.parseFloat(view?.getComputedStyle(scroller).paddingBottom ?? '');
      const inset = Number.isFinite(padding) ? padding : 0;
      scroller.style.scrollPaddingBottom = `${Math.ceil(height + inset) + PINNED_ROW_CLEARANCE_PX}px`;
    };
    apply();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply);
    observer?.observe(row);
    return () => {
      observer?.disconnect();
      scroller.style.scrollPaddingBottom = previous;
    };
  }, [rowRef, active]);
}

export function ApprovalGateDialog({
  gate,
  onApprove,
  onCancel,
  autoFocus = false,
  approveLabel = 'Approve',
  cancelLabel = 'Cancel',
  cancelVariant = 'ghost',
  cancelRef,
  approveDisabled = false,
  scrollContainer = 'own',
  actionSummary,
  children,
}: {
  gate: ApprovalGate;
  onApprove: () => void;
  onCancel: () => void;
  /**
   * Focus Approve on mount. Set by the quick-start dialog, where the gate
   * replaces the content the user was last focused on — without this, focus
   * falls to `document.body` inside an `aria-modal` region and keyboard users
   * have nothing to tab from. The panel leaves it off: the gate appears
   * beside other content there and stealing focus would be a hijack.
   */
  autoFocus?: boolean;
  /**
   * Label for the approve button. The quick-start plan review says "Build it":
   * that click is what starts spending tokens, so it names the action (#6831).
   */
  approveLabel?: string;
  /**
   * Label for the cancel button. The plan review says "Discard plan" because
   * its footer also has "Close", which keeps the plan: two exits with different
   * consequences must not share a vague name.
   */
  cancelLabel?: string;
  /**
   * The cancel button's variant. The plan review arms Discard on the first
   * press and shows the armed button as destructive.
   */
  cancelVariant?: 'ghost' | 'destructive';
  /** Ref to the cancel button, so the plan review can return focus to Discard. */
  cancelRef?: Ref<HTMLButtonElement>;
  /** Disables approve, e.g. while the confirmed action is already starting. */
  approveDisabled?: boolean;
  /**
   * Who scrolls a long summary.
   *
   * `'own'` (default; the orchestrator panel): the summary is bounded to its
   * own `max-h-[50vh]` keyboard-reachable scroll region, with the cost and
   * the buttons below it.
   *
   * `'parent'`: the gate sits inside a container that already scrolls — the
   * `@spawnforge/ui` `Dialog` body, in the quick-start dialog. A second
   * bounded scroller there would nest one scroll box in another, and on a
   * short viewport the outer one carries the inner box's buttons out of view.
   * So the summary is not bounded and flows into the parent's single scroll,
   * and ONLY the Approve/Cancel row is `sticky bottom-0`: pinned to the
   * parent's visible bottom edge while everything above it scrolls behind it.
   * `children` (the cost, notices) stay in normal flow directly above that
   * row. They are not pinned with it because a sticky block taller than the
   * parent's scrollport cannot be scrolled into view at any offset, and the
   * plan review's cost + balance warning + discard prompt can be that tall on
   * a phone (PR #10294 round 3). What must stay in view with the buttons
   * goes in `actionSummary` instead. The parent's scroll padding is kept at
   * the strip the row covers, so focus and `scrollIntoView` stop above the
   * row rather than under it (`usePinnedRowScrollPadding`).
   */
  scrollContainer?: 'own' | 'parent';
  /**
   * One short line that travels WITH the buttons, above them in the action
   * row: the plan review's token total. In `'parent'` mode the row is pinned,
   * so this is the one piece of `children`-like content guaranteed to be in
   * view whenever Approve is, which is the point: the total must be visible
   * when "Build it" is pressed, even while the full cost breakdown is
   * scrolled away (PR #10294 round 3: a cost the user has to scroll to find
   * is not a cost they confirmed). Keep it to a line or two. It is pinned, and
   * a pinned block taller than the scrollport has a part no offset reveals.
   */
  actionSummary?: ReactNode;
  /**
   * Extra content between the summary and the buttons — the plan review's
   * token cost. In `'own'` mode it sits outside the bounded summary box, so it
   * is always next to the buttons. In `'parent'` mode it scrolls with the
   * summary and ends directly above the pinned button row.
   */
  children?: ReactNode;
}) {
  const { displayData } = gate;
  const approveRef = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoFocus) approveRef.current?.focus();
    // gate.id so a second gate in the same run re-focuses.
  }, [autoFocus, gate.id]);

  const headingId = `approval-gate-heading-${gate.id}`;
  const ownScroll = scrollContainer === 'own';
  usePinnedRowScrollPadding(rowRef, !ownScroll);

  return (
    <div className="rounded-[var(--sf-radius-md)] border border-[var(--sf-warning)] bg-[var(--sf-bg-surface)] p-4">
      {/*
       * Text pairs with `--sf-text` rather than `--sf-warning`: the token is
       * pinned >= 3:1 as a non-text colour (the border above already uses it
       * for that), but as text-on-surface it measures ~3.64:1 in the light
       * theme against the 4.5:1 AA floor `text-sm font-semibold` requires —
       * this is not "large text" under WCAG 1.4.3. There is deliberately no
       * `--sf-warning-foreground` token (see OrchestratorPanel's
       * WARNING_SURFACE_CLASSES for the same pattern applied to a sibling
       * surface).
       */}
      <h3 id={headingId} className="mb-1 text-sm font-semibold text-[var(--sf-text)]">
        {gate.label}
      </h3>
      <p className="mb-3 text-xs text-[var(--sf-text-secondary)]">{gate.description}</p>

      {/*
       * A large plan (many scenes / many generated assets) has no natural
       * height limit. In 'own' mode (the orchestrator panel) nothing above
       * this box bounds it, so it bounds itself — without that the
       * Approve/Reject row below gets pushed out of reach.
       *
       * tabIndex + role="region" + aria-labelledby make the region itself
       * keyboard-reachable: without them a keyboard-only user has no way to
       * move focus into this box and scroll it (a mouse wheel/trackpad is
       * the only path to the content below the fold).
       *
       * In 'parent' mode the enclosing scroller (the Dialog body) already
       * does both jobs — it is bounded and becomes a labelled, focusable
       * region while it overflows — so this box is plain content.
       */}
      <div
        data-testid={ownScroll ? 'approval-gate-scroll' : 'approval-gate-summary'}
        className={ownScroll ? 'mb-3 max-h-[50vh] overflow-y-auto pr-1' : 'mb-3'}
        {...(ownScroll ? { tabIndex: 0, role: 'region', 'aria-labelledby': headingId } : {})}
      >
        {/* Scene summaries */}
        {displayData.sceneSummaries && displayData.sceneSummaries.length > 0 && (
          <div className="mb-3 space-y-1">
            <h4 className="text-xs font-medium text-[var(--sf-text)]">Scenes</h4>
            {displayData.sceneSummaries.map((scene) => (
              <div key={scene.name} className={ROW}>
                <span className="text-[var(--sf-text)]">{scene.name}</span>
                <span className="ml-2">({scene.entityCount} entities)</span>
              </div>
            ))}
          </div>
        )}

        {/* Asset list */}
        {displayData.assetList && displayData.assetList.length > 0 && (
          <div className="mb-3 space-y-1">
            <h4 className="text-xs font-medium text-[var(--sf-text)]">Assets to generate</h4>
            {displayData.assetList.map((asset, i) => (
              <div key={i} className={cn('flex items-center justify-between', ROW)}>
                <span>{asset.description}</span>
                <span className="font-mono">{asset.estimatedTokenCost} tokens</span>
              </div>
            ))}
          </div>
        )}

        {/* Completion summary */}
        {displayData.completionSummary && (
          <div className={ROW}>
            <span>{displayData.completionSummary.totalEntities} entities, </span>
            <span>{displayData.completionSummary.totalScenes} scenes, </span>
            <span>{displayData.completionSummary.totalScripts} scripts</span>
            {displayData.completionSummary.warnings.length > 0 && (
              // Same AA-text pairing as the gate heading above: `--sf-warning`
              // stays on the border/accent role, text pairs with `--sf-text`.
              <div className="mt-1 border-l-2 border-[var(--sf-warning)] pl-2 text-[var(--sf-text)]">
                {displayData.completionSummary.warnings.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/*
       * Normal flow in both modes. In 'parent' mode a control in here that
       * takes focus (the cost's "Buy tokens" link, the discard prompt's "Keep
       * plan") is kept clear of the pinned row below by the parent scroller's
       * scroll padding (`usePinnedRowScrollPadding`), not by anything on these
       * elements.
       */}
      {children && (
        <div data-testid="approval-gate-extra" className="mb-3">
          {children}
        </div>
      )}

      {/*
       * In 'parent' mode ONLY this row is sticky: it pins to the parent
       * scroller's bottom edge (opaque bg so content scrolling underneath stays
       * hidden). It must stay a direct child of the gate's root: a sticky box
       * cannot leave its parent, so it can only follow the summary while its
       * parent spans the summary too. It holds the buttons and, at most, the
       * one-line `actionSummary`; nothing else may join it: a sticky block
       * taller than the scrollport has a part no scroll offset reveals.
       */}
      <div
        ref={rowRef}
        data-testid="approval-gate-actions"
        className={cn(!ownScroll && 'sticky bottom-0 bg-[var(--sf-bg-surface)] pt-2')}
      >
        {actionSummary && (
          <div data-testid="approval-gate-action-summary" className="mb-2">
            {actionSummary}
          </div>
        )}
        <div data-testid="approval-gate-buttons" className="flex gap-2">
          <Button
            ref={approveRef}
            type="button"
            size="sm"
            onClick={onApprove}
            disabled={approveDisabled}
            className="flex-1"
          >
            {approveLabel}
          </Button>
          <Button ref={cancelRef} type="button" size="sm" variant={cancelVariant} onClick={onCancel} className="flex-1">
            {cancelLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
