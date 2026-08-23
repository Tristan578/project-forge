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
});
