/**
 * Tests for ChatInput — message sending, keyboard shortcuts, model selection,
 * thinking/approval toggles, entity picker trigger, voice, image attach.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ChatInput } from '../ChatInput';
import { useChatStore } from '@/stores/chatStore';

vi.mock('@/stores/chatStore', () => ({
  useChatStore: Object.assign(vi.fn(() => ({})), {
    setState: vi.fn(),
  }),
}));

vi.mock('../EntityPicker', () => ({
  EntityPicker: ({ onSelect, onClose }: { onSelect: (name: string, id: string) => void; onClose: () => void }) => (
    <div data-testid="entity-picker">
      <button data-testid="pick-entity" onClick={() => onSelect('Player', 'ent-1')}>Pick</button>
      <button data-testid="close-picker" onClick={onClose}>Close</button>
    </div>
  ),
}));

const mockSendMessage = vi.fn();
const mockStopStreaming = vi.fn();
const mockSetModel = vi.fn();
const mockSetThinkingEnabled = vi.fn();
const mockSetApprovalMode = vi.fn();
const mockSetShowEntityPicker = vi.fn();
const mockSetEntityPickerFilter = vi.fn();
const mockAddEntityRef = vi.fn();
const mockClearEntityRefs = vi.fn();

function setupStore(overrides: {
  isStreaming?: boolean;
  showEntityPicker?: boolean;
  pendingEntityRefs?: Record<string, string>;
  thinkingEnabled?: boolean;
  approvalMode?: boolean;
} = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useChatStore).mockImplementation((selector: any) => {
    const state = {
      sendMessage: mockSendMessage,
      stopStreaming: mockStopStreaming,
      isStreaming: overrides.isStreaming ?? false,
      activeModel: 'claude-sonnet-4-5-20250929',
      setModel: mockSetModel,
      thinkingEnabled: overrides.thinkingEnabled ?? false,
      setThinkingEnabled: mockSetThinkingEnabled,
      approvalMode: overrides.approvalMode ?? false,
      setApprovalMode: mockSetApprovalMode,
      showEntityPicker: overrides.showEntityPicker ?? false,
      setShowEntityPicker: mockSetShowEntityPicker,
      setEntityPickerFilter: mockSetEntityPickerFilter,
      pendingEntityRefs: overrides.pendingEntityRefs ?? {},
      addEntityRef: mockAddEntityRef,
      clearEntityRefs: mockClearEntityRefs,
    };
    return selector(state);
  });
}

describe('ChatInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Basic rendering ───────────────────────────────────────────────────

  it('renders textarea with placeholder', () => {
    setupStore();
    render(<ChatInput />);
    expect(screen.getByPlaceholderText(/Describe what you want/)).toBeDefined();
  });

  it('renders send button', () => {
    setupStore();
    render(<ChatInput />);
    expect(screen.getByLabelText('Send message')).toBeDefined();
  });

  it('send button is disabled when textarea is empty', () => {
    setupStore();
    render(<ChatInput />);
    const sendBtn = screen.getByLabelText('Send message');
    expect(sendBtn.hasAttribute('disabled')).toBe(true);
  });

  it('renders model selector', () => {
    setupStore();
    render(<ChatInput />);
    expect(screen.getByLabelText('AI model')).toBeDefined();
  });

  it('renders Think button', () => {
    setupStore();
    render(<ChatInput />);
    expect(screen.getByText('Think')).toBeDefined();
  });

  it('renders Review button', () => {
    setupStore();
    render(<ChatInput />);
    expect(screen.getByText('Review')).toBeDefined();
  });

  it('renders attach and voice buttons', () => {
    setupStore();
    render(<ChatInput />);
    expect(screen.getByLabelText('Attach image')).toBeDefined();
    expect(screen.getByLabelText('Voice input')).toBeDefined();
  });

  // ── Sending messages ──────────────────────────────────────────────────

  it('sends message on Enter key', () => {
    setupStore();
    render(<ChatInput />);
    const textarea = screen.getByLabelText('Chat message');
    fireEvent.change(textarea, { target: { value: 'Hello AI' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(mockSendMessage).toHaveBeenCalledWith('Hello AI', undefined, undefined);
    expect(mockClearEntityRefs).toHaveBeenCalled();
  });

  it('does not send on Shift+Enter (allows newline)', () => {
    setupStore();
    render(<ChatInput />);
    const textarea = screen.getByLabelText('Chat message');
    fireEvent.change(textarea, { target: { value: 'Hello AI' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('does not send empty message', () => {
    setupStore();
    render(<ChatInput />);
    const textarea = screen.getByLabelText('Chat message');
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('does not send while streaming', () => {
    setupStore({ isStreaming: true });
    render(<ChatInput />);
    const textarea = screen.getByLabelText('Chat message');
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('sends message on send button click', () => {
    setupStore();
    render(<ChatInput />);
    const textarea = screen.getByLabelText('Chat message');
    fireEvent.change(textarea, { target: { value: 'Build a cube' } });
    fireEvent.click(screen.getByLabelText('Send message'));
    expect(mockSendMessage).toHaveBeenCalledWith('Build a cube', undefined, undefined);
  });

  it('clears textarea after sending', () => {
    setupStore();
    render(<ChatInput />);
    const textarea = screen.getByLabelText('Chat message') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(textarea.value).toBe('');
  });

  // ── Streaming state ───────────────────────────────────────────────────

  it('shows stop button when streaming', () => {
    setupStore({ isStreaming: true });
    render(<ChatInput />);
    expect(screen.getByLabelText('Stop streaming')).toBeDefined();
  });

  it('calls stopStreaming when stop button clicked', () => {
    setupStore({ isStreaming: true });
    render(<ChatInput />);
    fireEvent.click(screen.getByLabelText('Stop streaming'));
    expect(mockStopStreaming).toHaveBeenCalledOnce();
  });

  it('disables textarea when streaming', () => {
    setupStore({ isStreaming: true });
    render(<ChatInput />);
    const textarea = screen.getByLabelText('Chat message') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });

  // ── Model selection ───────────────────────────────────────────────────

  it('changes model when selector changes', () => {
    setupStore();
    render(<ChatInput />);
    const select = screen.getByLabelText('AI model') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'claude-haiku-4-5-20251001' } });
    expect(mockSetModel).toHaveBeenCalledWith('claude-haiku-4-5-20251001');
  });

  // ── Think / Review toggles ────────────────────────────────────────────

  it('toggles thinking mode', () => {
    setupStore({ thinkingEnabled: false });
    render(<ChatInput />);
    fireEvent.click(screen.getByText('Think'));
    expect(mockSetThinkingEnabled).toHaveBeenCalledWith(true);
  });

  it('toggles approval mode', () => {
    setupStore({ approvalMode: false });
    render(<ChatInput />);
    fireEvent.click(screen.getByText('Review'));
    expect(mockSetApprovalMode).toHaveBeenCalledWith(true);
  });

  // ── Entity picker ─────────────────────────────────────────────────────

  it('triggers entity picker on @ input', () => {
    setupStore();
    render(<ChatInput />);
    const textarea = screen.getByLabelText('Chat message') as HTMLTextAreaElement;
    // Simulate typing @ which triggers the entity picker
    fireEvent.change(textarea, { target: { value: '@' } });
    expect(mockSetShowEntityPicker).toHaveBeenCalledWith(true);
  });

  it('hides entity picker when @ removed', () => {
    setupStore();
    render(<ChatInput />);
    const textarea = screen.getByLabelText('Chat message');
    fireEvent.change(textarea, { target: { value: 'hello' } });
    expect(mockSetShowEntityPicker).toHaveBeenCalledWith(false);
  });

  it('renders entity picker when showEntityPicker is true', () => {
    setupStore({ showEntityPicker: true });
    render(<ChatInput />);
    expect(screen.getByTestId('entity-picker')).toBeDefined();
  });

  it('does not render entity picker when showEntityPicker is false', () => {
    setupStore({ showEntityPicker: false });
    render(<ChatInput />);
    expect(screen.queryByTestId('entity-picker')).toBeNull();
  });

  // ── Entity ref chips ──────────────────────────────────────────────────

  it('renders entity reference chips when present', () => {
    setupStore({ pendingEntityRefs: { '@Player': 'ent-1', '@Enemy': 'ent-2' } });
    render(<ChatInput />);
    expect(screen.getByText('@Player')).toBeDefined();
    expect(screen.getByText('@Enemy')).toBeDefined();
  });

  it('does not render entity chips when empty', () => {
    setupStore({ pendingEntityRefs: {} });
    render(<ChatInput />);
    expect(screen.queryByText(/@\w+/)).toBeNull();
  });

  // ── Sends with entity refs ────────────────────────────────────────────

  it('includes entity refs in sent message', () => {
    setupStore({ pendingEntityRefs: { '@Player': 'ent-1' } });
    render(<ChatInput />);
    const textarea = screen.getByLabelText('Chat message');
    fireEvent.change(textarea, { target: { value: 'Move @Player' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(mockSendMessage).toHaveBeenCalledWith(
      'Move @Player',
      undefined,
      { '@Player': 'ent-1' },
    );
  });

  // ── Keyboard does nothing during entity picker ────────────────────────

  it('does not send on Enter when entity picker is open', () => {
    setupStore({ showEntityPicker: true });
    render(<ChatInput />);
    const textarea = screen.getByLabelText('Chat message');
    fireEvent.change(textarea, { target: { value: '@Pl' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
