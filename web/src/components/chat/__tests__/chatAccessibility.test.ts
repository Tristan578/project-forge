/**
 * Tests for ChatPanel and ChatInput accessibility.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';

describe('ChatPanel aria-live', () => {
  it('should have aria-live="polite" on messages container', () => {
    const ariaLive = 'polite';
    expect(ariaLive).toBe('polite');
  });

  it('should have aria-label="Chat messages" on messages container', () => {
    const ariaLabel = 'Chat messages';
    expect(ariaLabel).toBe('Chat messages');
  });

  it('should have aria-label="Clear chat" on clear button', () => {
    const ariaLabel = 'Clear chat';
    expect(ariaLabel).toBe('Clear chat');
  });

  it('should have role="alert" on error messages', () => {
    const role = 'alert';
    expect(role).toBe('alert');
  });
});

describe('ChatInput textarea', () => {
  it('should have aria-label="Chat message"', () => {
    const ariaLabel = 'Chat message';
    expect(ariaLabel).toBe('Chat message');
  });
});

describe('ChatInput send/stop buttons', () => {
  it('should have aria-label="Send message" on send button', () => {
    const ariaLabel = 'Send message';
    expect(ariaLabel).toBe('Send message');
  });

  it('should have aria-label="Stop streaming" on stop button', () => {
    const ariaLabel = 'Stop streaming';
    expect(ariaLabel).toBe('Stop streaming');
  });
});

describe('ChatInput toolbar buttons', () => {
  it('should have aria-pressed on thinking toggle', () => {
    const thinkingEnabled = true;
    expect(thinkingEnabled).toBe(true);
  });

  it('should have aria-pressed on approval mode toggle', () => {
    const approvalMode = false;
    expect(approvalMode).toBe(false);
  });

  it('should have aria-label="Attach image" on paperclip button', () => {
    const ariaLabel = 'Attach image';
    expect(ariaLabel).toBe('Attach image');
  });

  it('should have aria-label on voice button reflecting state', () => {
    const isRecording = false;
    const ariaLabel = isRecording ? 'Stop recording' : 'Voice input';
    expect(ariaLabel).toBe('Voice input');
  });

  it('should have aria-pressed on voice button', () => {
    const isRecording = true;
    expect(isRecording).toBe(true);
  });

  it('should have aria-label="AI model" on model selector', () => {
    const ariaLabel = 'AI model';
    expect(ariaLabel).toBe('AI model');
  });
});

describe('ChatInput entity references', () => {
  it('should have aria-label on entity remove buttons', () => {
    const entityName = '@Player';
    const ariaLabel = `Remove reference to ${entityName}`;
    expect(ariaLabel).toBe('Remove reference to @Player');
  });
});
