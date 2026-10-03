/**
 * Render tests for ApprovalGateDialog.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ApprovalGateDialog, PINNED_ROW_CLEARANCE_PX } from '../ApprovalGateDialog';
import type { ApprovalGate } from '@/lib/game-creation/types';

function makeGate(overrides: Partial<ApprovalGate['displayData']> = {}): ApprovalGate {
  return {
    id: 'gate-1',
    label: 'Review the plan',
    description: 'Check the scenes and assets before we generate them.',
    afterStepId: 'plan',
    status: 'pending',
    displayData: overrides,
  };
}

describe('ApprovalGateDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the gate label and description', () => {
    render(<ApprovalGateDialog gate={makeGate()} onApprove={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Review the plan')).toBeInTheDocument();
    expect(screen.getByText('Check the scenes and assets before we generate them.')).toBeInTheDocument();
  });

  it('calls onApprove when Approve is clicked', () => {
    const onApprove = vi.fn();
    render(<ApprovalGateDialog gate={makeGate()} onApprove={onApprove} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn();
    render(<ApprovalGateDialog gate={makeGate()} onApprove={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('focuses Approve on mount when autoFocus is set', () => {
    render(<ApprovalGateDialog gate={makeGate()} onApprove={vi.fn()} onCancel={vi.fn()} autoFocus />);
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveFocus();
  });

  it('does not steal focus when autoFocus is unset', () => {
    render(<ApprovalGateDialog gate={makeGate()} onApprove={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Approve' })).not.toHaveFocus();
  });

  // PF-1215: a large plan (many scenes/assets) must not push the Approve/
  // Reject row off the bottom of the dialog with no way to reach it.
  it('bounds the scene/asset/summary content in a scrollable container', () => {
    render(
      <ApprovalGateDialog
        gate={makeGate({
          sceneSummaries: [{ name: 'Level 1', entityCount: 12, systemDescriptions: [] }],
          assetList: [{ description: 'Hero sprite', type: 'sprite', estimatedTokenCost: 40, hasFallback: false }],
        })}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const scrollContainer = screen.getByTestId('approval-gate-scroll');
    expect(scrollContainer.className).toContain('overflow-y-auto');
    expect(scrollContainer.className).toContain('max-h-[50vh]');
  });

  it('still renders the scroll container when there is no scene/asset/summary data', () => {
    render(<ApprovalGateDialog gate={makeGate()} onApprove={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByTestId('approval-gate-scroll')).toBeInTheDocument();
  });

  it('renders scene summaries inside the scroll container', () => {
    render(
      <ApprovalGateDialog
        gate={makeGate({
          sceneSummaries: [{ name: 'Level 1', entityCount: 12, systemDescriptions: [] }],
        })}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('Level 1')).toBeInTheDocument();
    expect(screen.getByText('(12 entities)')).toBeInTheDocument();
  });

  it('renders the asset list with token costs', () => {
    render(
      <ApprovalGateDialog
        gate={makeGate({
          assetList: [{ description: 'Hero sprite', type: 'sprite', estimatedTokenCost: 40, hasFallback: false }],
        })}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('Hero sprite')).toBeInTheDocument();
    expect(screen.getByText('40 tokens')).toBeInTheDocument();
  });

  it('renders the completion summary with warnings', () => {
    render(
      <ApprovalGateDialog
        gate={makeGate({
          completionSummary: {
            totalEntities: 5,
            totalScenes: 2,
            totalScripts: 1,
            warnings: ['Missing a win condition'],
          },
        })}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('Missing a win condition')).toBeInTheDocument();
  });

  // PF-1215 round 2 (5/5 UX BLOCKER): a keyboard-only user has no mouse
  // wheel/trackpad to reach content below the fold, so the scroll region
  // itself must be a reachable, labelled landmark, not just a CSS overflow
  // box. Resolving the accessible name via role+name proves aria-labelledby
  // points at the REAL heading id, not just that the attribute is present.
  it('exposes the scroll region as a keyboard-reachable, labelled landmark', () => {
    render(<ApprovalGateDialog gate={makeGate()} onApprove={vi.fn()} onCancel={vi.fn()} />);
    const region = screen.getByRole('region', { name: 'Review the plan' });
    expect(region).toHaveAttribute('data-testid', 'approval-gate-scroll');
    expect(region).toHaveAttribute('tabIndex', '0');
  });

  // PF-1215 round 2 (3/5 UX BLOCKER): `--sf-warning` measures ~3.64:1 on
  // `--sf-bg-surface` in the light theme, below the 4.5:1 AA floor for
  // `text-sm font-semibold` (not "large text" under WCAG 1.4.3). The token
  // stays valid for the border (a non-text role, pinned >= 3:1 in
  // themes.test.ts); only the TEXT color must move to `--sf-text`.
  it('pairs the gate heading text with --sf-text, not --sf-warning', () => {
    render(<ApprovalGateDialog gate={makeGate()} onApprove={vi.fn()} onCancel={vi.fn()} />);
    const heading = screen.getByText('Review the plan');
    expect(heading.className).toContain('text-[var(--sf-text)]');
    expect(heading.className).not.toContain('text-[var(--sf-warning)]');
  });

  // #6831: the quick-start plan review reuses this dialog with its own labels,
  // a guard against a second click, and the build's token cost as children.
  describe('plan-review options', () => {
    it('names the buttons after what they do', () => {
      render(
        <ApprovalGateDialog
          gate={makeGate()}
          onApprove={vi.fn()}
          onCancel={vi.fn()}
          approveLabel="Build it"
          cancelLabel="Discard plan"
        />,
      );
      expect(screen.getByRole('button', { name: 'Build it' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Discard plan' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    });

    it('makes approve inert while approveDisabled is set', () => {
      const onApprove = vi.fn();
      render(<ApprovalGateDialog gate={makeGate()} onApprove={onApprove} onCancel={vi.fn()} approveDisabled />);
      const approve = screen.getByRole('button', { name: 'Approve' });
      expect(approve).toBeDisabled();
      fireEvent.click(approve);
      expect(onApprove).not.toHaveBeenCalled();
    });

    // A cost the user has to scroll to find is not a cost they confirmed.
    it('renders children outside the scrollable summary, between it and the buttons', () => {
      render(
        <ApprovalGateDialog
          gate={makeGate({ sceneSummaries: [{ name: 'Level 1', entityCount: 3, systemDescriptions: [] }] })}
          onApprove={vi.fn()}
          onCancel={vi.fn()}
        >
          <p>Estimated token cost 340</p>
        </ApprovalGateDialog>,
      );
      const cost = screen.getByText('Estimated token cost 340');
      const scroll = screen.getByTestId('approval-gate-scroll');
      expect(scroll.contains(cost)).toBe(false);
      const approve = screen.getByRole('button', { name: 'Approve' });
      // DOCUMENT_POSITION_FOLLOWING: scroll region, then the cost, then Approve.
      expect(scroll.compareDocumentPosition(cost) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(cost.compareDocumentPosition(approve) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  // PR #10294: the @spawnforge/ui Dialog body is now a scroller of its own, so
  // inside it the gate must not bring a second bounded scroller (nested
  // scrolling carries the inner box's buttons out of view on a short
  // viewport). In 'parent' mode the summary flows into the enclosing scroll
  // and ONLY the action row sticks to its bottom edge (round 3: a sticky
  // footer that also carried the cost could grow taller than the scrollport,
  // leaving its top unreachable at every scroll offset). Round 4: that row
  // also carries a one-line `actionSummary` (the token total), so the total
  // is in view whenever Approve is.
  describe("scrollContainer='parent'", () => {
    const SCROLLER = /(^|\s)(overflow-(y-)?(auto|scroll)|max-h-\S+)(\s|$)/;

    function renderParentMode({ actionSummary }: { actionSummary?: ReactNode } = {}) {
      return render(
        <ApprovalGateDialog
          actionSummary={actionSummary}
          gate={makeGate({
            sceneSummaries: [{ name: 'Level 1', entityCount: 3, systemDescriptions: [] }],
          })}
          onApprove={vi.fn()}
          onCancel={vi.fn()}
          scrollContainer="parent"
        >
          <p>Estimated token cost 340</p>
        </ApprovalGateDialog>,
      );
    }

    it('brings no scroll box, max-height bound or region of its own', () => {
      const { container } = renderParentMode();
      // Non-vacuous: the gate rendered and the summary is in it.
      expect(screen.getByText('Level 1')).toBeInTheDocument();
      const elements = Array.from(container.querySelectorAll<HTMLElement>('*'));
      expect(elements.length).toBeGreaterThan(5);
      for (const el of elements) {
        expect(el.getAttribute('class') ?? '', `bounded scroller: ${el.outerHTML.slice(0, 80)}`).not.toMatch(SCROLLER);
      }
      expect(screen.queryByTestId('approval-gate-scroll')).toBeNull();
      expect(screen.queryByRole('region')).toBeNull();
      expect(screen.getByTestId('approval-gate-summary')).not.toHaveAttribute('tabindex');
    });

    it('makes the action row the ONE sticky element, holding only the buttons and the one-line summary', () => {
      const { container } = renderParentMode({ actionSummary: <span>Cost: 340 tokens</span> });
      const approve = screen.getByRole('button', { name: 'Approve' });
      const cancel = screen.getByRole('button', { name: 'Cancel' });

      // Derived from the DOM, not named: every sticky element the gate renders.
      const sticky = Array.from(container.querySelectorAll<HTMLElement>('.sticky'));
      expect(sticky).toHaveLength(1);
      const [row] = sticky;
      expect(row).toBe(screen.getByTestId('approval-gate-actions'));
      expect(row.classList.contains('bottom-0')).toBe(true);
      // An opaque background, so the content scrolling underneath is hidden.
      expect(row.className).toContain('bg-[var(--sf-bg-surface)]');
      // Only the summary line and the buttons: nothing else (the cost
      // breakdown, notices, prompts) can make the pinned block taller.
      const summary = screen.getByTestId('approval-gate-action-summary');
      const buttons = screen.getByTestId('approval-gate-buttons');
      expect(Array.from(row.children)).toEqual([summary, buttons]);
      expect(Array.from(buttons.children)).toEqual([approve, cancel]);
      expect(summary.textContent).toBe('Cost: 340 tokens');

      // The full cost stays in normal flow, before the row.
      const cost = screen.getByText('Estimated token cost 340');
      expect(row.contains(cost)).toBe(false);
      expect(cost.closest('.sticky')).toBeNull();
      expect(cost.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      // A sticky box cannot leave its parent, so the row is a direct child of
      // the gate root that also holds the plan summary: it can follow the
      // whole summary, not just a wrapper the size of the row.
      const planSummary = screen.getByTestId('approval-gate-summary');
      expect(planSummary.contains(screen.getByText('Level 1'))).toBe(true);
      expect(row.parentElement).toBe(planSummary.parentElement);
      expect(row.parentElement?.lastElementChild).toBe(row);
    });

    it('renders no summary slot in the row when there is no actionSummary', () => {
      renderParentMode();
      const row = screen.getByTestId('approval-gate-actions');
      expect(Array.from(row.children)).toEqual([screen.getByTestId('approval-gate-buttons')]);
      expect(screen.queryByTestId('approval-gate-action-summary')).toBeNull();
    });

    // The row covers the bottom strip of the parent scroller's visible area.
    // The browser only keeps a focused control (or a scrollIntoView target)
    // clear of that strip if the scroller's scroll padding says so; a scroll
    // MARGIN on the target is not part of Chromium's focus check (PR #10294
    // round 3). jsdom has no layout, so this pins the VALUE the gate writes;
    // e2e/tests/quick-start-plan-review-layout.spec.ts measures the result in
    // Chromium.
    describe('scroll padding on the parent scroller', () => {
      type Callback = () => void;
      const observers: { callback: Callback; observed: Element[] }[] = [];
      let rowHeight = 0;

      beforeEach(() => {
        observers.length = 0;
        rowHeight = 52.4;
        vi.stubGlobal(
          'ResizeObserver',
          class {
            observed: Element[] = [];
            constructor(public callback: Callback) {
              observers.push(this);
            }
            observe(el: Element) {
              this.observed.push(el);
            }
            disconnect() {
              this.observed = [];
            }
          },
        );
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
          this: HTMLElement,
        ) {
          const height = this.dataset.testid === 'approval-gate-actions' ? rowHeight : 0;
          return { x: 0, y: 0, top: 0, left: 0, right: 0, width: 0, bottom: height, height, toJSON: () => ({}) };
        });
      });

      afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
      });

      function renderInScroller(scrollContainer: 'own' | 'parent') {
        return render(
          <div data-testid="scroller" style={{ overflowY: 'auto', paddingBottom: '12px', scrollPaddingBottom: '3px' }}>
            {/* A non-scrolling wrapper in between: the gate must find the
                scroll container, not just its parent. */}
            <div data-testid="wrapper">
              <ApprovalGateDialog gate={makeGate()} onApprove={vi.fn()} onCancel={vi.fn()} scrollContainer={scrollContainer}>
                <p>Estimated token cost 340</p>
              </ApprovalGateDialog>
            </div>
          </div>,
        );
      }

      it('covers the row height plus the scroller bottom padding, follows the row as it resizes, and restores the old value on unmount', () => {
        const { unmount } = renderInScroller('parent');
        const scroller = screen.getByTestId('scroller');
        expect(screen.getByTestId('wrapper').style.scrollPaddingBottom).toBe('');
        // ceil(52.4 + 12) + 8 = 73: the sticky row pins 12px above the
        // scrollport edge (the scroller's padding), and is 52.4px tall.
        expect(scroller.style.scrollPaddingBottom).toBe(`${Math.ceil(52.4 + 12) + PINNED_ROW_CLEARANCE_PX}px`);
        expect(PINNED_ROW_CLEARANCE_PX).toBeGreaterThan(0);

        // The row grew (a wrapped summary line, a narrower viewport).
        const row = screen.getByTestId('approval-gate-actions');
        const observer = observers.find((o) => o.observed.includes(row));
        expect(observer).toBeDefined();
        rowHeight = 92;
        observer?.callback();
        expect(scroller.style.scrollPaddingBottom).toBe(`${92 + 12 + PINNED_ROW_CLEARANCE_PX}px`);

        unmount();
        expect(scroller.style.scrollPaddingBottom).toBe('3px');
        expect(observer?.observed).toEqual([]);
      });

      it("leaves the scroller's scroll padding alone in 'own' mode", () => {
        renderInScroller('own');
        expect(screen.getByTestId('scroller').style.scrollPaddingBottom).toBe('3px');
        expect(observers).toHaveLength(0);
      });
    });

    it("pins nothing in the default 'own' mode", () => {
      const { container } = render(
        <ApprovalGateDialog gate={makeGate()} onApprove={vi.fn()} onCancel={vi.fn()}>
          <p>Estimated token cost 340</p>
        </ApprovalGateDialog>,
      );
      // Non-vacuous: the row and the extras rendered.
      expect(screen.getByTestId('approval-gate-actions')).toBeInTheDocument();
      expect(container.querySelectorAll('.sticky')).toHaveLength(0);
    });
  });
});
