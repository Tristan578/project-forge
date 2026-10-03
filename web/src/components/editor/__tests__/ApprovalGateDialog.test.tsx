/**
 * Render tests for ApprovalGateDialog.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ApprovalGateDialog } from '../ApprovalGateDialog';
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
  // and ONLY the Approve/Cancel row sticks to its bottom edge (round 3: a
  // sticky footer that also carried the cost could grow taller than the
  // scrollport, leaving its top unreachable at every scroll offset).
  describe("scrollContainer='parent'", () => {
    const SCROLLER = /(^|\s)(overflow-(y-)?(auto|scroll)|max-h-\S+)(\s|$)/;

    function renderParentMode() {
      return render(
        <ApprovalGateDialog
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

    it('makes the action row the ONE sticky element, holding nothing but the two buttons', () => {
      const { container } = renderParentMode();
      const approve = screen.getByRole('button', { name: 'Approve' });
      const cancel = screen.getByRole('button', { name: 'Cancel' });

      // Derived from the DOM, not named: every sticky element the gate renders.
      const sticky = Array.from(container.querySelectorAll<HTMLElement>('.sticky'));
      expect(sticky).toHaveLength(1);
      const [row] = sticky;
      expect(row.classList.contains('bottom-0')).toBe(true);
      // An opaque background, so the content scrolling underneath is hidden.
      expect(row.className).toContain('bg-[var(--sf-bg-surface)]');
      // Only the action row: its children are exactly the two buttons, so
      // nothing else (cost, notices, prompts) can make it taller.
      expect(Array.from(row.children)).toEqual([approve, cancel]);

      // The cost stays in normal flow, before the row.
      const cost = screen.getByText('Estimated token cost 340');
      expect(row.contains(cost)).toBe(false);
      expect(cost.closest('.sticky')).toBeNull();
      expect(cost.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      // A sticky box cannot leave its parent, so the row is a direct child of
      // the gate root that also holds the summary: it can follow the whole
      // summary, not just a wrapper the size of the row.
      const summary = screen.getByTestId('approval-gate-summary');
      expect(summary.contains(screen.getByText('Level 1'))).toBe(true);
      expect(row.parentElement).toBe(summary.parentElement);
      expect(row.parentElement?.lastElementChild).toBe(row);
    });

    it('gives the in-flow extras a bottom scroll margin, so a focused control is not hidden under the pinned row', () => {
      renderParentMode();
      const extra = screen.getByTestId('approval-gate-extra');
      expect(extra.contains(screen.getByText('Estimated token cost 340'))).toBe(true);
      expect(Array.from(extra.classList).some((c) => /^\[&_\*\]:scroll-mb-\d+$/.test(c))).toBe(true);
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
      expect(Array.from(screen.getByTestId('approval-gate-extra').classList).some((c) => c.includes('scroll-mb'))).toBe(false);
    });
  });
});
