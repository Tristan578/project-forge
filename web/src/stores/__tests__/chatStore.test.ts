import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '../chatStore';

describe('chatStore', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      isStreaming: false,
      activeModel: 'claude-sonnet-4-5-20250929',
      rightPanelTab: 'inspector',
      error: null,
      sessionTokens: { input: 0, output: 0 },
    });
  });

  it('initializes with default state', () => {
    const state = useChatStore.getState();
    expect(state.messages).toEqual([]);
    expect(state.isStreaming).toBe(false);
    expect(state.activeModel).toContain('claude');
  });

  it('sets model correctly', () => {
    useChatStore.getState().setModel('claude-haiku-4-5-20251001');
    expect(useChatStore.getState().activeModel).toBe('claude-haiku-4-5-20251001');
  });

  it('clears chat', () => {
    useChatStore.setState({ messages: [{ id: '1', role: 'user', content: 'hi', timestamp: 123 }] });
    useChatStore.getState().clearChat();
    expect(useChatStore.getState().messages).toHaveLength(0);
  });

  it('updates right panel tab', () => {
    useChatStore.getState().setRightPanelTab('chat');
    expect(useChatStore.getState().rightPanelTab).toBe('chat');
  });
});
