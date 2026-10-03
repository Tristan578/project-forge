'use client';

/**
 * ApprovalGateDialog — the inline approval prompt for one pipeline gate.
 *
 * Lives in its own module so the quick-start dialog can render the same gate
 * without a second copy of the markup. A quick-start run auto-approves
 * `gate_plan` ONLY, so `gate_assets` / `gate_final` still stop the run: whoever
 * started it has to be able to answer them from where they are standing.
 *
 * Two layouts share one markup:
 * - `ApprovalGateDialog` (the orchestrator panel): the gate's summary in its
 *   own bounded scroll region, with the buttons below it (and any `children`
 *   between the two). The panel shows the plan's cost in its own
 *   `TokenCostBar`, above the gate, so it passes no children.
 * - `ApprovalGateSummary` + `ApprovalGateActions` (the quick-start dialog):
 *   the summary flows into the `@spawnforge/ui` Dialog body, which is the
 *   one scroller, and the buttons go in the Dialog's `actions` footer, which
 *   does not scroll. PR #10294 first pinned the buttons inside the body
 *   (`sticky`) and kept focus clear of them with the body's scroll padding;
 *   board rounds 3 and 4 showed that every layer of that fought the scroller: Firefox does not honour
 *   the padding for focus scrolling the way Chromium does, focusing a pinned
 *   button scrolled the body, and on a 320px-tall viewport the row covered
 *   the very prompt it was confirming. A row outside the scroller has none of
 *   those failure modes, in any browser, because nothing scrolls under it.
 *
 * Every colour here is a `--sf-*` token, not a Tailwind palette shade. The
 * previous zinc/amber/green markup was rendered inside the token-themed
 * `@spawnforge/ui` Dialog, so on the light theme `text-amber-200` on
 * `bg-amber-950/30` inverted into near-invisible text — a WCAG AA failure that
 * only appeared on 6 of the 7 themes.
 */

import { useEffect, useRef, type ReactNode, type Ref } from 'react';
import { Button, cn } from '@spawnforge/ui';
import type { ApprovalGate } from '@/lib/game-creation/types';

const ROW = 'rounded-[var(--sf-radius-sm)] bg-[var(--sf-bg-elevated)] px-2 py-1 text-xs text-[var(--sf-text-secondary)]';

/** The card around a gate's heading, summary and extras. */
const CARD = 'rounded-[var(--sf-radius-md)] border border-[var(--sf-warning)] bg-[var(--sf-bg-surface)] p-4';

/** The id of a gate's heading, which also labels its summary region and its action group. */
function headingIdFor(gate: ApprovalGate): string {
  return `approval-gate-heading-${gate.id}`;
}

/**
 * The gate's heading, description, plan summary and extras. `bounded` gives
 * the summary its own scroll region (the panel); otherwise it flows into the
 * enclosing scroller.
 */
function GateContent({
  gate,
  bounded,
  children,
}: {
  gate: ApprovalGate;
  bounded: boolean;
  children?: ReactNode;
}) {
  const { displayData } = gate;
  const headingId = headingIdFor(gate);
  return (
    <>
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
       * height limit. In the panel nothing above this box bounds it, so it
       * bounds itself — without that the Approve/Reject row below gets pushed
       * out of reach.
       *
       * tabIndex + role="region" + aria-labelledby make the region itself
       * keyboard-reachable: without them a keyboard-only user has no way to
       * move focus into this box and scroll it (a mouse wheel/trackpad is
       * the only path to the content below the fold).
       *
       * Unbounded (the quick-start dialog), the enclosing scroller (the
       * Dialog body) already does both jobs — it is bounded and becomes a
       * labelled, focusable region while it overflows — so this box is plain
       * content. A second bounded scroller there would nest one scroll box in
       * another, and on a short viewport the outer one carries the inner box
       * out of view.
       */}
      <div
        data-testid={bounded ? 'approval-gate-scroll' : 'approval-gate-summary'}
        className={bounded ? 'mb-3 max-h-[50vh] overflow-y-auto pr-1' : 'mb-3'}
        {...(bounded ? { tabIndex: 0, role: 'region', 'aria-labelledby': headingId } : {})}
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

      {children && (
        <div data-testid="approval-gate-extra" className="mb-3">
          {children}
        </div>
      )}
    </>
  );
}

export interface ApprovalGateActionsProps {
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
   * While its Discard is armed the same button reads "Discard it".
   */
  approveLabel?: string;
  /**
   * The approve button's variant: the primary action by default, destructive
   * while the plan review's armed Discard puts "Discard it" in this place.
   */
  approveVariant?: 'default' | 'destructive';
  /**
   * Label for the cancel button. The plan review says "Discard plan" because
   * its footer also has "Close", which keeps the plan: two exits with different
   * consequences must not share a vague name.
   */
  cancelLabel?: string;
  /**
   * The cancel button's variant. The panel's plan review arms Discard on the
   * first press and shows the armed button as destructive; the quick-start
   * review's armed row puts an outlined "Keep plan" here instead.
   */
  cancelVariant?: 'ghost' | 'destructive' | 'outline';
  /** Ref to the cancel button, so the plan review can return focus to Discard. */
  cancelRef?: Ref<HTMLButtonElement>;
  /** Disables approve, e.g. while the confirmed action is already starting. */
  approveDisabled?: boolean;
  /**
   * One short line above the buttons, in the same group: the plan review's
   * token total, or, while its Discard is armed, the "Discard this plan?"
   * question. In the quick-start dialog this row is the non-scrolling footer,
   * so whatever is here is in view whenever the buttons are (PR #10294: a
   * cost the user has to scroll to find is not a cost they confirmed). Keep
   * it to a line or two: it takes height from the scroller above it, and on
   * a 320px-tall viewport that is all the height there is. Text only; it
   * must hold nothing that takes focus.
   */
  summary?: ReactNode;
  className?: string;
}

/**
 * A gate's Approve / Cancel row, with an optional one-line summary above the
 * buttons. A `role="group"` named by the gate's heading, so a screen reader
 * hears which gate the buttons answer even when the row is rendered apart
 * from that heading (the quick-start dialog puts it in the Dialog footer).
 */
export function ApprovalGateActions({
  gate,
  onApprove,
  onCancel,
  autoFocus = false,
  approveLabel = 'Approve',
  approveVariant = 'default',
  cancelLabel = 'Cancel',
  cancelVariant = 'ghost',
  cancelRef,
  approveDisabled = false,
  summary,
  className,
}: ApprovalGateActionsProps) {
  const approveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autoFocus) approveRef.current?.focus();
    // gate.id so a second gate in the same run re-focuses.
  }, [autoFocus, gate.id]);

  // Pressing Approve can disable it while the action starts (the plan
  // review's "Build it"), and a browser drops focus from a button that
  // becomes disabled: Chromium moves it to <body>, outside the `aria-modal`
  // dialog. If the action is refused the gate stays, the button comes back
  // enabled, and focus is still nowhere (measured, PR #10294 board round 4). Put it
  // back on the button, unless the user has since focused something else.
  // Never onto a destructive button: the plan review re-enables this place as
  // "Discard it" when Discard is armed during an in-flight Build it, and
  // focus handed to it unasked is one Enter away from throwing the plan out.
  const wasDisabledRef = useRef(approveDisabled);
  useEffect(() => {
    const wasDisabled = wasDisabledRef.current;
    wasDisabledRef.current = approveDisabled;
    if (!wasDisabled || approveDisabled || approveVariant === 'destructive') return;
    const active = approveRef.current?.ownerDocument.activeElement;
    if (!active || active === approveRef.current?.ownerDocument.body) approveRef.current?.focus();
  }, [approveDisabled, approveVariant]);

  return (
    <div
      data-testid="approval-gate-actions"
      role="group"
      aria-labelledby={headingIdFor(gate)}
      className={className}
    >
      {summary && (
        <div data-testid="approval-gate-action-summary" className="mb-2">
          {summary}
        </div>
      )}
      <div data-testid="approval-gate-buttons" className="flex gap-2">
        <Button
          ref={approveRef}
          type="button"
          size="sm"
          variant={approveVariant}
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
  );
}

/**
 * A gate's card WITHOUT its buttons, for a container that already scrolls
 * (the quick-start dialog's Dialog body). The summary is not bounded: it
 * flows into that one scroll. Render the same gate's `ApprovalGateActions`
 * in the container's non-scrolling footer; this card has no buttons of its
 * own, so a gate rendered without them cannot be answered.
 */
export function ApprovalGateSummary({ gate, children }: { gate: ApprovalGate; children?: ReactNode }) {
  return (
    <div className={CARD}>
      <GateContent gate={gate} bounded={false}>
        {children}
      </GateContent>
    </div>
  );
}

/**
 * The whole gate in one card, buttons included, for the orchestrator panel:
 * the summary bounds itself and the buttons (and any `children`) sit below
 * that bound, so they are never scrolled away with it.
 */
export function ApprovalGateDialog({
  children,
  ...actions
}: Omit<ApprovalGateActionsProps, 'summary' | 'className'> & {
  /**
   * Optional extra content, rendered between the bounded summary and the
   * buttons: outside the summary's scroll region, so it stays beside the
   * buttons however long the summary is. No caller in the app passes it
   * today (the panel's cost is its own `TokenCostBar`; the quick-start
   * review passes its cost to `ApprovalGateSummary`).
   */
  children?: ReactNode;
}) {
  return (
    <div className={CARD}>
      <GateContent gate={actions.gate} bounded>
        {children}
      </GateContent>
      <ApprovalGateActions {...actions} />
    </div>
  );
}
