import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '../chatStore';

describe('chatStore advanced', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      isStreaming: false,
      thinkingEnabled: false,
      approvalMode: false,
    });
  });

  it('toggles thinking mode', () => {
    useChatStore.getState().setThinkingEnabled(true);
    expect(useChatStore.getState().thinkingEnabled).toBe(true);
  });

  it('toggles approval mode', () => {
    useChatStore.getState().setApprovalMode(true);
    expect(useChatStore.getState().approvalMode).toBe(true);
  });

  it('clears unread state when switching to chat tab', () => {
    useChatStore.setState({ hasUnreadMessages: true });
    useChatStore.getState().setRightPanelTab('chat');
    expect(useChatStore.getState().hasUnreadMessages).toBe(false);
  });

  it('sets message feedback', () => {
    const msgId = 'test_msg';
    useChatStore.setState({ messages: [{ id: msgId, role: 'assistant', content: 'hello', timestamp: 123 }] });
    
    useChatStore.getState().setMessageFeedback(msgId, 'positive');
    expect(useChatStore.getState().messages[0].feedback).toBe('positive');
  });
});
