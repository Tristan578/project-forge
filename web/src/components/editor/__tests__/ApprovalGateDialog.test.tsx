/**
 * Render tests for ApprovalGateDialog.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ApprovalGateActions, ApprovalGateDialog, ApprovalGateSummary } from '../ApprovalGateDialog';
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

    // Extras stay beside the buttons however long the bounded summary is.
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

  // PR #10294: the @spawnforge/ui Dialog body is a scroller of its own, so in
  // the quick-start dialog the gate is split. Its summary flows into that one
  // scroll (a second bounded scroller nested inside it carries the inner box
  // out of view on a short viewport), and its buttons go in the Dialog's
  // footer, outside the scroll. An earlier iteration of this PR pinned the
  // buttons inside the body instead (sticky + scroll padding); in a real browser that covered
  // content, scrolled the body on every focus, and failed in Firefox. jsdom
  // has no layout, so these pin the structure; the geometry is measured by
  // e2e/tests/quick-start-plan-review-layout.spec.ts.
  describe('ApprovalGateSummary and ApprovalGateActions (for a parent that scrolls)', () => {
    const SCROLLER = /(^|\s)(overflow-(y-)?(auto|scroll)|max-h-\S+)(\s|$)/;
    const gate = makeGate({ sceneSummaries: [{ name: 'Level 1', entityCount: 3, systemDescriptions: [] }] });

    it('renders the summary with no scroll box, height bound, region or button of its own', () => {
      const { container } = render(
        <ApprovalGateSummary gate={gate}>
          <p>Estimated token cost 340</p>
        </ApprovalGateSummary>,
      );
      // Non-vacuous: the heading, the plan and the extras all rendered.
      expect(screen.getByRole('heading', { name: 'Review the plan' })).toBeInTheDocument();
      expect(screen.getByText('Level 1')).toBeInTheDocument();
      expect(screen.getByText('Estimated token cost 340')).toBeInTheDocument();
      const elements = Array.from(container.querySelectorAll<HTMLElement>('*'));
      expect(elements.length).toBeGreaterThan(5);
      for (const el of elements) {
        expect(el.getAttribute('class') ?? '', `bounded scroller: ${el.outerHTML.slice(0, 80)}`).not.toMatch(SCROLLER);
      }
      expect(screen.queryByTestId('approval-gate-scroll')).toBeNull();
      expect(screen.queryByRole('region')).toBeNull();
      expect(screen.getByTestId('approval-gate-summary')).not.toHaveAttribute('tabindex');
      // The buttons belong to the parent's footer, not to this card.
      expect(screen.queryAllByRole('button')).toEqual([]);
      expect(screen.queryByTestId('approval-gate-actions')).toBeNull();
    });

    it('renders the action row as a group named by the gate heading: summary line, then the two buttons', () => {
      const onApprove = vi.fn();
      const onCancel = vi.fn();
      render(
        <>
          <ApprovalGateSummary gate={gate} />
          <footer>
            <ApprovalGateActions
              gate={gate}
              onApprove={onApprove}
              onCancel={onCancel}
              approveLabel="Build it"
              cancelLabel="Discard plan"
              summary={<span>Cost: 340 tokens</span>}
            />
          </footer>
        </>,
      );
      // Rendered apart from the heading, the row still says which gate it answers.
      const group = screen.getByRole('group', { name: 'Review the plan' });
      expect(group).toBe(screen.getByTestId('approval-gate-actions'));
      const summary = screen.getByTestId('approval-gate-action-summary');
      const buttons = screen.getByTestId('approval-gate-buttons');
      expect(Array.from(group.children)).toEqual([summary, buttons]);
      expect(summary.textContent).toBe('Cost: 340 tokens');
      const build = screen.getByRole('button', { name: 'Build it' });
      const discard = screen.getByRole('button', { name: 'Discard plan' });
      expect(Array.from(buttons.children)).toEqual([build, discard]);
      // Nothing in the row is pinned: it is meant for a footer that does not scroll.
      expect(document.querySelectorAll('.sticky')).toHaveLength(0);

      fireEvent.click(build);
      fireEvent.click(discard);
      expect(onApprove).toHaveBeenCalledTimes(1);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('renders no summary slot when there is no summary', () => {
      render(<ApprovalGateActions gate={gate} onApprove={vi.fn()} onCancel={vi.fn()} />);
      const group = screen.getByTestId('approval-gate-actions');
      expect(Array.from(group.children)).toEqual([screen.getByTestId('approval-gate-buttons')]);
      expect(screen.queryByTestId('approval-gate-action-summary')).toBeNull();
    });

    it('focuses Approve on mount when autoFocus is set, and not otherwise', () => {
      const { unmount } = render(<ApprovalGateActions gate={gate} onApprove={vi.fn()} onCancel={vi.fn()} autoFocus />);
      expect(screen.getByRole('button', { name: 'Approve' })).toHaveFocus();
      unmount();
      render(<ApprovalGateActions gate={gate} onApprove={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Approve' })).not.toHaveFocus();
    });

    // PR #10294 board round 9 (ux HIGH, defence in depth): the plan review can
    // mount this row with "Discard it" in Approve's place. Focus goes to the
    // cancel answer, never the destructive one. Not focusing at all is not
    // enough: the Dialog's deferred initial focus takes the first focusable
    // control, which is the destructive button when the body holds none.
    it('focuses the cancel answer, never a destructive approve, on mount', () => {
      render(
        <ApprovalGateActions
          gate={gate}
          onApprove={vi.fn()}
          onCancel={vi.fn()}
          approveLabel="Discard it"
          approveVariant="destructive"
          cancelLabel="Keep plan"
          autoFocus
        />,
      );
      expect(screen.getByRole('button', { name: 'Discard it' })).not.toHaveFocus();
      expect(screen.getByRole('button', { name: 'Keep plan' })).toHaveFocus();
    });

    // Focus is taken once per gate. The plan review swaps the same row
    // between "Build it" and "Discard it"; Keep plan returns focus to its own
    // button, and a variant change must not pull it back onto Approve.
    it('does not re-take focus when the same gate changes variant, and does for a new gate', () => {
      const row = (id: string, armed: boolean) => (
        <>
          <ApprovalGateActions
            gate={{ ...gate, id }}
            onApprove={vi.fn()}
            onCancel={vi.fn()}
            approveLabel={armed ? 'Discard it' : 'Build it'}
            approveVariant={armed ? 'destructive' : 'default'}
            cancelLabel={armed ? 'Keep plan' : 'Discard plan'}
            autoFocus
          />
          <button type="button">Elsewhere</button>
        </>
      );
      const { rerender } = render(row('gate_plan', false));
      expect(screen.getByRole('button', { name: 'Build it' })).toHaveFocus();
      const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
      elsewhere.focus();
      rerender(row('gate_plan', true));
      expect(elsewhere).toHaveFocus();
      rerender(row('gate_plan', false));
      expect(elsewhere).toHaveFocus();
      rerender(row('gate_assets', false));
      expect(screen.getByRole('button', { name: 'Build it' })).toHaveFocus();
    });

    // The latch, branch by branch (PR #10294 board round 10, test seat): each
    // case below goes red when the branch it names is deleted.
    describe('the once-per-gate latch', () => {
      const row = ({
        autoFocus = true,
        armed = false,
        disabled = false,
      }: { autoFocus?: boolean; armed?: boolean; disabled?: boolean } = {}) => (
        <>
          <ApprovalGateActions
            gate={gate}
            onApprove={vi.fn()}
            onCancel={vi.fn()}
            approveLabel={armed ? 'Discard it' : 'Build it'}
            approveVariant={armed ? 'destructive' : 'default'}
            cancelLabel={armed ? 'Keep plan' : 'Discard plan'}
            approveDisabled={!armed && disabled}
            autoFocus={autoFocus}
          />
          <button type="button">Elsewhere</button>
        </>
      );

      // `!autoFocus` resets the latch: a caller that turns autoFocus off and
      // on again is asking for focus again.
      it('focuses again when autoFocus is turned off and back on', () => {
        const { rerender } = render(row());
        const build = screen.getByRole('button', { name: 'Build it' });
        expect(build).toHaveFocus();
        rerender(row({ autoFocus: false }));
        const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
        elsewhere.focus();
        rerender(row());
        expect(build).toHaveFocus();
      });

      // ... and drops a focus that was waiting on a disabled Approve, so the
      // fresh request is not mistaken for that wait.
      it('drops a waiting focus when autoFocus is turned off', () => {
        const { rerender } = render(row({ disabled: true }));
        rerender(row({ autoFocus: false, disabled: true }));
        const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
        elsewhere.focus();
        rerender(row());
        expect(screen.getByRole('button', { name: 'Build it' })).toHaveFocus();
      });

      // The destructive branch latches too: Keep plan backs out of the armed
      // row by turning it back into Build it, and focus stays on the button
      // the user is on rather than jumping to Build it.
      it('latches on the destructive mount, so disarming does not pull focus onto Approve', () => {
        const { rerender } = render(row({ armed: true }));
        const cancel = screen.getByRole('button', { name: 'Keep plan' });
        expect(cancel).toHaveFocus();
        rerender(row());
        expect(screen.getByRole('button', { name: 'Build it' })).not.toHaveFocus();
        expect(cancel).toHaveFocus();
        expect(cancel.textContent).toBe('Discard plan');
      });
    });

    // PR #10294 board round 10 (ux, architect): the plan review reopened while
    // its "Build it" is still starting mounts this row with Approve disabled.
    // Focusing a disabled button does nothing, and latching the gate's one
    // focus on that no-op meant a refused start never put focus on "Build
    // it". The focus waits for the button to be enabled.
    describe('mounted with Approve disabled', () => {
      const row = (disabled: boolean, armed = false) => (
        <>
          <div role="status" tabIndex={-1}>
            Starting the build…
          </div>
          <ApprovalGateActions
            gate={gate}
            onApprove={vi.fn()}
            onCancel={vi.fn()}
            approveLabel={armed ? 'Discard it' : 'Build it'}
            approveVariant={armed ? 'destructive' : 'default'}
            cancelLabel={armed ? 'Keep plan' : 'Discard plan'}
            approveDisabled={!armed && disabled}
            autoFocus
          />
          <button type="button">Elsewhere</button>
        </>
      );

      it('focuses Approve once it is enabled, from a status line the caller parked focus on', () => {
        const { rerender } = render(row(true));
        const build = screen.getByRole('button', { name: 'Build it' });
        expect(build).toBeDisabled();
        expect(build).not.toHaveFocus();
        const status = screen.getByRole('status');
        status.focus();
        expect(status).toHaveFocus();

        rerender(row(false));
        expect(build).toHaveFocus();
        // Taken once: a later variant change of the same gate does not take
        // it again.
        const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
        elsewhere.focus();
        rerender(row(false, true));
        rerender(row(false));
        expect(elsewhere).toHaveFocus();
      });

      it('focuses Approve once it is enabled when focus is on the page body', () => {
        const { rerender } = render(row(true));
        expect(document.activeElement).toBe(document.body);
        rerender(row(false));
        expect(screen.getByRole('button', { name: 'Build it' })).toHaveFocus();
      });

      // `document.activeElement` is null in a document with no body; with no
      // focus anywhere, nothing the user chose is taken away.
      it('focuses Approve once it is enabled when there is no active element at all', () => {
        const { rerender } = render(row(true));
        const build = screen.getByRole('button', { name: 'Build it' });
        const focus = vi.spyOn(HTMLButtonElement.prototype, 'focus');
        Object.defineProperty(document, 'activeElement', { configurable: true, get: () => null });
        let focusedButtons: unknown[];
        try {
          expect(document.activeElement).toBeNull();
          rerender(row(false));
          focusedButtons = [...focus.mock.contexts];
        } finally {
          delete (document as { activeElement?: unknown }).activeElement;
          focus.mockRestore();
        }
        expect(document.activeElement).not.toBeNull();
        expect(focusedButtons).toContain(build);
      });

      // PR #10294 board round 11 (test). The wait belongs to the gate that
      // mounted disabled. A NEW gate that mounts with Approve enabled has
      // waited for nothing, so it takes focus as usual, even from a control
      // the user focused while the earlier gate was waiting.
      it('focuses a new gate\'s enabled Approve even though an earlier gate waited', () => {
        const rowFor = (id: string, disabled: boolean) => (
          <>
            <ApprovalGateActions
              gate={{ ...gate, id }}
              onApprove={vi.fn()}
              onCancel={vi.fn()}
              approveLabel="Build it"
              approveDisabled={disabled}
              autoFocus
            />
            <button type="button">Elsewhere</button>
          </>
        );
        const { rerender } = render(rowFor('gate_a', true));
        expect(screen.getByRole('button', { name: 'Build it' })).toBeDisabled();
        const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
        elsewhere.focus();
        expect(elsewhere).toHaveFocus();

        rerender(rowFor('gate_b', false));
        expect(screen.getByRole('button', { name: 'Build it' })).toHaveFocus();
      });

      it('leaves focus on a control the user chose while Approve was disabled', () => {
        const { rerender } = render(row(true));
        const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
        elsewhere.focus();
        rerender(row(false));
        expect(elsewhere).toHaveFocus();
      });
    });
  });

  // PR #10294 board round 4, measured in Chromium: "Build it" is disabled while the
  // build starts, the browser drops focus from a disabled button to <body>,
  // and a refused build re-enabled the button with focus still on <body>,
  // outside the aria-modal dialog.
  describe('focus after a disabled Approve comes back', () => {
    function renderGate(approveDisabled: boolean) {
      return (
        <>
          <ApprovalGateActions gate={makeGate()} onApprove={vi.fn()} onCancel={vi.fn()} approveDisabled={approveDisabled} />
          <button type="button">Elsewhere</button>
        </>
      );
    }

    it('returns focus to Approve when it is re-enabled while focus is on the page body', () => {
      const { rerender } = render(renderGate(false));
      const approve = screen.getByRole('button', { name: 'Approve' });
      approve.focus();
      rerender(renderGate(true));
      // What the browser does to a focused button that becomes disabled:
      // focus falls to <body>. (jsdom ignores blur() on a disabled element,
      // so the fall is reproduced by removing a focused stand-in.)
      const standIn = document.createElement('input');
      document.body.append(standIn);
      standIn.focus();
      standIn.remove();
      expect(document.activeElement).toBe(document.body);
      rerender(renderGate(false));
      expect(approve).toHaveFocus();
    });

    it('leaves focus alone when the user has moved it elsewhere', () => {
      const { rerender } = render(renderGate(true));
      const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
      elsewhere.focus();
      rerender(renderGate(false));
      expect(elsewhere).toHaveFocus();
    });

    it('does not take focus on mount, or on a re-render that leaves it enabled', () => {
      const { rerender } = render(renderGate(false));
      expect(document.activeElement).toBe(document.body);
      rerender(renderGate(false));
      expect(document.activeElement).toBe(document.body);
    });

    // PR #10294 board round 5 (test): arming the plan review's Discard during an
    // in-flight Build it re-enables this place as a destructive "Discard it".
    // Focus on <body> must not be handed to it: Enter would discard the plan.
    it('never hands focus to a destructive button it re-enables', () => {
      const { rerender } = render(renderGate(true));
      expect(document.activeElement).toBe(document.body);
      rerender(
        <ApprovalGateActions
          gate={makeGate()}
          onApprove={vi.fn()}
          onCancel={vi.fn()}
          approveDisabled={false}
          approveLabel="Discard it"
          approveVariant="destructive"
        />,
      );
      const discardIt = screen.getByRole('button', { name: 'Discard it' });
      expect(discardIt).toBeEnabled();
      expect(document.activeElement).toBe(document.body);
    });
  });

  it('keeps the panel layout in one card: bounded summary, extras, then the action group', () => {
    const { container } = render(
      <ApprovalGateDialog gate={makeGate()} onApprove={vi.fn()} onCancel={vi.fn()}>
        <p>Estimated token cost 340</p>
      </ApprovalGateDialog>,
    );
    const card = container.firstElementChild as HTMLElement;
    const group = screen.getByRole('group', { name: 'Review the plan' });
    expect(card.contains(group)).toBe(true);
    expect(card.lastElementChild).toBe(group);
    expect(card.contains(screen.getByTestId('approval-gate-scroll'))).toBe(true);
    expect(container.querySelectorAll('.sticky')).toHaveLength(0);
  });
});
