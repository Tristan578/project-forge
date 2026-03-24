/**
 * Tests for useAiChat hook.
 *
 * useAiChat is a thin wrapper around @ai-sdk/react useChat, wiring it to
 * /api/chat via DefaultChatTransport. Tests verify:
 *  - The hook delegates to useChat
 *  - The correct transport / API path is passed through
 *  - sendMessage, status, stop, and messages are forwarded from useChat
 *  - Streaming, abort, and error scenarios behave correctly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAiChat } from '../useAiChat';

// ── Mock @ai-sdk/react and ai ─────────────────────────────────────────────────

const mockSendMessage = vi.fn();
const mockStop = vi.fn();
const mockSetInput = vi.fn();
const mockAppend = vi.fn();
const mockReload = vi.fn();
const mockSetMessages = vi.fn();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockChatReturn = any;

const defaultUseChatReturn: MockChatReturn = {
  id: 'mock-chat-id',
  messages: [],
  sendMessage: mockSendMessage,
  status: 'idle',
  stop: mockStop,
  error: undefined,
  input: '',
  setInput: mockSetInput,
  setMessages: mockSetMessages,
  append: mockAppend,
  reload: mockReload,
  isLoading: false,
  regenerate: vi.fn(),
  resumeStream: vi.fn(),
  addToolResult: vi.fn(),
  addToolOutput: vi.fn(),
  addToolApprovalResponse: vi.fn(),
  clearError: vi.fn(),
};

vi.mock('@ai-sdk/react', () => ({
  useChat: vi.fn(() => defaultUseChatReturn),
}));

vi.mock('ai', () => ({
  DefaultChatTransport: vi.fn().mockImplementation(function (
    this: { api: string },
    opts: { api: string },
  ) {
    this.api = opts.api;
  }),
}));

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useAiChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useChat).mockReturnValue(defaultUseChatReturn);
  });

  // ── Transport wiring ──────────────────────────────────────────────────

  it('creates DefaultChatTransport pointing to /api/chat', () => {
    renderHook(() => useAiChat());
    expect(DefaultChatTransport).toHaveBeenCalledWith({ api: '/api/chat' });
  });

  it('passes a transport instance to useChat', () => {
    renderHook(() => useAiChat());
    const callArgs = vi.mocked(useChat).mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(callArgs).toBeDefined();
    expect(callArgs).toHaveProperty('transport');
    expect(callArgs!.transport).toBeInstanceOf(DefaultChatTransport);
  });

  it('passes only the transport option to useChat (hook is intentionally minimal)', () => {
    renderHook(() => useAiChat());
    const callArgs = vi.mocked(useChat).mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(callArgs).toBeDefined();
    // Should only have the transport key — no extra config
    expect(Object.keys(callArgs!)).toEqual(['transport']);
  });

  // ── Return value passthrough ──────────────────────────────────────────

  it('returns messages from useChat', () => {
    const messages = [{ id: '1', role: 'user', content: 'Hello', parts: [] }];
    vi.mocked(useChat).mockReturnValue({ ...defaultUseChatReturn, messages });

    const { result } = renderHook(() => useAiChat());
    expect(result.current.messages).toBe(messages);
  });

  it('returns sendMessage from useChat', () => {
    const { result } = renderHook(() => useAiChat());
    expect(result.current.sendMessage).toBe(mockSendMessage);
  });

  it('returns stop from useChat', () => {
    const { result } = renderHook(() => useAiChat());
    expect(result.current.stop).toBe(mockStop);
  });

  it('returns status from useChat', () => {
    vi.mocked(useChat).mockReturnValue({ ...defaultUseChatReturn, status: 'streaming' });

    const { result } = renderHook(() => useAiChat());
    expect(result.current.status).toBe('streaming');
  });

  it('returns error from useChat when present', () => {
    const err = new Error('API error');
    vi.mocked(useChat).mockReturnValue({ ...defaultUseChatReturn, error: err });

    const { result } = renderHook(() => useAiChat());
    expect(result.current.error).toBe(err);
  });

  // ── Sending messages ──────────────────────────────────────────────────

  it('invokes sendMessage with a text message', () => {
    const { result } = renderHook(() => useAiChat());

    act(() => {
      result.current.sendMessage({ text: 'Create a cube' });
    });

    expect(mockSendMessage).toHaveBeenCalledWith({ text: 'Create a cube' });
  });

  it('invokes sendMessage without modifying its arguments', () => {
    const { result } = renderHook(() => useAiChat());
    const payload = { text: 'Add a light' };

    act(() => {
      result.current.sendMessage(payload);
    });

    expect(mockSendMessage).toHaveBeenCalledWith(payload);
  });

  it('sendMessage can be called multiple times', () => {
    const { result } = renderHook(() => useAiChat());

    act(() => {
      result.current.sendMessage({ text: 'First message' });
      result.current.sendMessage({ text: 'Second message' });
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(mockSendMessage).toHaveBeenNthCalledWith(1, { text: 'First message' });
    expect(mockSendMessage).toHaveBeenNthCalledWith(2, { text: 'Second message' });
  });

  // ── Streaming ─────────────────────────────────────────────────────────

  it('reflects streaming status while a response is in flight', () => {
    vi.mocked(useChat).mockReturnValue({
      ...defaultUseChatReturn,
      status: 'streaming',
      messages: [{ id: '1', role: 'user', content: 'Hello', parts: [] }],
    });

    const { result } = renderHook(() => useAiChat());
    expect(result.current.status).toBe('streaming');
    expect(result.current.messages).toHaveLength(1);
  });

  it('transitions from streaming to idle after completion', () => {
    vi.mocked(useChat).mockReturnValue({
      ...defaultUseChatReturn,
      status: 'idle',
      messages: [
        { id: '1', role: 'user', content: 'Hello', parts: [] },
        { id: '2', role: 'assistant', content: 'Hi!', parts: [] },
      ],
    });

    const { result } = renderHook(() => useAiChat());
    expect(result.current.status).toBe('idle');
    expect(result.current.messages).toHaveLength(2);
  });

  // ── Abort / stop ──────────────────────────────────────────────────────

  it('calls stop to abort an in-progress stream', () => {
    vi.mocked(useChat).mockReturnValue({ ...defaultUseChatReturn, status: 'streaming' });

    const { result } = renderHook(() => useAiChat());

    act(() => {
      result.current.stop();
    });

    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('stop can be called in idle state without throwing', () => {
    const { result } = renderHook(() => useAiChat());

    expect(() => {
      act(() => {
        result.current.stop();
      });
    }).not.toThrow();

    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  // ── Error handling ────────────────────────────────────────────────────

  it('exposes error when useChat returns an error', () => {
    const networkErr = new Error('Network timeout');
    vi.mocked(useChat).mockReturnValue({
      ...defaultUseChatReturn,
      error: networkErr,
      status: 'error',
    });

    const { result } = renderHook(() => useAiChat());

    expect(result.current.error).toBe(networkErr);
    expect(result.current.error?.message).toBe('Network timeout');
  });

  it('error is undefined in the normal idle state', () => {
    const { result } = renderHook(() => useAiChat());
    expect(result.current.error).toBeUndefined();
  });
});
