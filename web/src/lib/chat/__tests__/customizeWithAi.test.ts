/**
 * "Customize with AI" (#10172): the toast's action pre-fills the composer and
 * reveals the chat. It must never send, because sending spends tokens the user
 * has not reviewed.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'sonner';
import { useChatStore } from '@/stores/chatStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { customizeDraftFor, offerCustomizeWithAi } from '../customizeWithAi';

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));

const sendMessage = vi.fn();

beforeEach(() => {
  vi.mocked(toast.success).mockReset();
  sendMessage.mockReset();
  useChatStore.setState({ composerDraft: '', sendMessage, rightPanelTab: 'inspector' });
  useWorkspaceStore.setState({ chatOverlayOpen: false });
});

/** The action the toast was shown with. */
function toastAction(): { label: string; onClick: () => void } {
  const call = vi.mocked(toast.success).mock.calls[0];
  if (!call) throw new Error('no toast was shown');
  const opts = call[1] as { action?: { label: string; onClick: () => void } } | undefined;
  if (!opts?.action) throw new Error('the toast has no action');
  return opts.action;
}

describe('offerCustomizeWithAi', () => {
  it('shows one toast naming the template, with a "Customize with AI" action', () => {
    offerCustomizeWithAi('3D Platformer');

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.success).mock.calls[0]?.[0]).toContain('3D Platformer');
    expect(toastAction().label).toBe('Customize with AI');
  });

  it('on click, pre-fills the composer and opens the chat without sending', () => {
    offerCustomizeWithAi('3D Platformer');

    toastAction().onClick();

    expect(useChatStore.getState().composerDraft).toBe(customizeDraftFor('3D Platformer'));
    expect(useChatStore.getState().composerDraft).toContain('3D Platformer');
    expect(useWorkspaceStore.getState().chatOverlayOpen).toBe(true);
    expect(useChatStore.getState().rightPanelTab).toBe('chat');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does nothing to the chat until the action is clicked', () => {
    offerCustomizeWithAi('3D Platformer');

    expect(useChatStore.getState().composerDraft).toBe('');
    expect(useWorkspaceStore.getState().chatOverlayOpen).toBe(false);
  });
});
