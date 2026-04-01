/**
 * Unit tests for useAiChat hook.
 *
 * Verifies DefaultChatTransport wiring, useChat passthrough,
 * sendMessage, streaming status, stop/abort, and error surface.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// vi.hoisted runs before vi.mock hoisting — safe to reference in factories
const { mockUseChat, MockDefaultChatTransport } = vi.hoisted(() => ({
  mockUseChat: vi.fn(),
  MockDefaultChatTransport: vi.fn(),
}));

vi.mock('@ai-sdk/react', () => ({
  useChat: mockUseChat,
}));

vi.mock('ai', () => ({
  DefaultChatTransport: MockDefaultChatTransport,
}));

import { useAiChat } from '../useAiChat';

describe('useAiChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Must return an object from a function invoked with `new`
    MockDefaultChatTransport.mockImplementation(function (this: { _api: string }, { api }: { api: string }) {
      this._api = api;
    });
    mockUseChat.mockReturnValue({
      messages: [],
      input: '',
      status: 'ready',
      handleInputChange: vi.fn(),
      handleSubmit: vi.fn(),
      stop: vi.fn(),
      error: undefined,
      setMessages: vi.fn(),
      append: vi.fn(),
    });
  });

  it('creates DefaultChatTransport with /api/chat endpoint', () => {
    renderHook(() => useAiChat());
    expect(MockDefaultChatTransport).toHaveBeenCalledWith({ api: '/api/chat' });
  });

  it('passes transport to useChat', () => {
    renderHook(() => useAiChat());
    expect(mockUseChat).toHaveBeenCalledWith({
      transport: expect.objectContaining({ _api: '/api/chat' }),
    });
  });

  it('returns useChat helpers unchanged', () => {
    const mockHelpers = {
      messages: [{ id: '1', role: 'user', content: 'hello' }],
      input: 'test',
      status: 'streaming',
      handleInputChange: vi.fn(),
      handleSubmit: vi.fn(),
      stop: vi.fn(),
      error: undefined,
      setMessages: vi.fn(),
      append: vi.fn(),
    };
    mockUseChat.mockReturnValue(mockHelpers);

    const { result } = renderHook(() => useAiChat());
    expect(result.current).toBe(mockHelpers);
  });

  it('exposes stop function for aborting streaming', () => {
    const stopFn = vi.fn();
    mockUseChat.mockReturnValue({
      messages: [],
      status: 'streaming',
      stop: stopFn,
    });

    const { result } = renderHook(() => useAiChat());
    act(() => {
      result.current.stop();
    });
    expect(stopFn).toHaveBeenCalledOnce();
  });

  it('surfaces error from useChat', () => {
    const testError = new Error('Stream failed');
    mockUseChat.mockReturnValue({
      messages: [],
      status: 'error',
      error: testError,
      stop: vi.fn(),
    });

    const { result } = renderHook(() => useAiChat());
    expect(result.current.error).toBe(testError);
    expect(result.current.status).toBe('error');
  });

  it('provides append for sending messages programmatically', () => {
    const appendFn = vi.fn();
    mockUseChat.mockReturnValue({
      messages: [],
      status: 'ready',
      append: appendFn,
      stop: vi.fn(),
    });

    const { result } = renderHook(() => useAiChat());
    const message = { role: 'user' as const, content: 'Build a platformer' };
    act(() => {
      result.current.append(message);
    });
    expect(appendFn).toHaveBeenCalledWith(message);
  });

  it('creates a new transport instance on each render', () => {
    const { rerender } = renderHook(() => useAiChat());
    const firstCallCount = MockDefaultChatTransport.mock.calls.length;
    rerender();
    expect(MockDefaultChatTransport.mock.calls.length).toBeGreaterThan(firstCallCount);
  });
});
