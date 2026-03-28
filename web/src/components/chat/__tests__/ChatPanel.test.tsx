// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ChatPanel } from '../ChatPanel';

vi.mock('lucide-react', () => ({
  MessageSquare: (props: Record<string, unknown>) => <span data-testid="message-square" {...props} />,
  Trash2: (props: Record<string, unknown>) => <span data-testid="trash-icon" {...props} />,
  Loader: (props: Record<string, unknown>) => <span data-testid="loader-icon" {...props} />,
  Send: (props: Record<string, unknown>) => <span data-testid="send-icon" {...props} />,
  Square: (props: Record<string, unknown>) => <span data-testid="square-icon" {...props} />,
  Paperclip: (props: Record<string, unknown>) => <span data-testid="paperclip-icon" {...props} />,
  Mic: (props: Record<string, unknown>) => <span data-testid="mic-icon" {...props} />,
  MicOff: (props: Record<string, unknown>) => <span data-testid="micoff-icon" {...props} />,
  Brain: (props: Record<string, unknown>) => <span data-testid="brain-icon" {...props} />,
  Shield: (props: Record<string, unknown>) => <span data-testid="shield-icon" {...props} />,
  ChevronDown: (props: Record<string, unknown>) => <span data-testid="chevron-down" {...props} />,
  ChevronRight: (props: Record<string, unknown>) => <span data-testid="chevron-right" {...props} />,
  ThumbsUp: (props: Record<string, unknown>) => <span data-testid="thumbs-up" {...props} />,
  ThumbsDown: (props: Record<string, unknown>) => <span data-testid="thumbs-down" {...props} />,
  RotateCcw: (props: Record<string, unknown>) => <span data-testid="rotate-ccw" {...props} />,
  Check: (props: Record<string, unknown>) => <span data-testid="check-icon" {...props} />,
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Loader2: (props: Record<string, unknown>) => <span data-testid="loader2-icon" {...props} />,
  Undo2: (props: Record<string, unknown>) => <span data-testid="undo-icon" {...props} />,
  Eye: (props: Record<string, unknown>) => <span data-testid="eye-icon" {...props} />,
  XCircle: (props: Record<string, unknown>) => <span data-testid="x-circle-icon" {...props} />,
  Box: (props: Record<string, unknown>) => <span data-testid="box-icon" {...props} />,
  Sun: (props: Record<string, unknown>) => <span data-testid="sun-icon" {...props} />,
  Lightbulb: (props: Record<string, unknown>) => <span data-testid="lightbulb-icon" {...props} />,
  Mountain: (props: Record<string, unknown>) => <span data-testid="mountain-icon" {...props} />,
  Sparkles: (props: Record<string, unknown>) => <span data-testid="sparkles-icon" {...props} />,
  Wrench: (props: Record<string, unknown>) => <span data-testid="wrench-icon" {...props} />,
  Plus: (props: Record<string, unknown>) => <span data-testid="plus-icon" {...props} />,
  Pencil: (props: Record<string, unknown>) => <span data-testid="pencil-icon" {...props} />,
}));

const mockClearChat = vi.fn();
const mockSendMessage = vi.fn();

// Mutable chat store state for per-test overrides
const mockChatState: Record<string, unknown> = {
  messages: [],
  isStreaming: false,
  error: null,
  clearChat: mockClearChat,
  sendMessage: mockSendMessage,
  loopIteration: 0,
  sessionTokens: { input: 0, output: 0 },
  rightPanelTab: 'chat',
  setRightPanelTab: vi.fn(),
  activeModel: 'claude-sonnet-4-5-20250929',
  setModel: vi.fn(),
  thinkingEnabled: false,
  setThinkingEnabled: vi.fn(),
  approvalMode: false,
  setApprovalMode: vi.fn(),
  showEntityPicker: false,
  setShowEntityPicker: vi.fn(),
  setEntityPickerFilter: vi.fn(),
  pendingEntityRefs: {},
  addEntityRef: vi.fn(),
  clearEntityRefs: vi.fn(),
  stopStreaming: vi.fn(),
  entityPickerFilter: '',
  setMessageFeedback: vi.fn(),
  batchUndoMessage: vi.fn(),
  approveToolCalls: vi.fn(),
  rejectToolCalls: vi.fn(),
  conversations: [],
  activeConversationId: null,
  createConversation: vi.fn(),
  switchConversation: vi.fn(),
  deleteConversation: vi.fn(),
  renameConversation: vi.fn(),
  loadConversations: vi.fn(),
};

vi.mock('@/stores/chatStore', () => ({
  useChatStore: Object.assign(
    vi.fn((selector: (s: Record<string, unknown>) => unknown) => selector(mockChatState)),
    { setState: vi.fn(), getState: vi.fn() },
  ),
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      sceneGraph: { nodes: {}, rootIds: [] },
      selectEntity: vi.fn(),
      selectedIds: new Set(),
      primaryId: null,
      undo: vi.fn(),
    })
  ),
}));

describe('ChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset state to defaults
    mockChatState.messages = [];
    mockChatState.isStreaming = false;
    mockChatState.error = null;
    mockChatState.loopIteration = 0;
    mockChatState.sessionTokens = { input: 0, output: 0 };
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    render(<ChatPanel />);
    expect(screen.getByText('AI Assistant')).toBeDefined();
  });

  it('shows description text and suggestion chips when no messages', () => {
    render(<ChatPanel />);
    expect(screen.getByText('Describe what you want to build.')).toBeDefined();
    // Dynamic suggestions should be rendered (empty scene suggestions)
    const buttons = screen.getAllByRole('button');
    // Should have suggestion chip buttons
    const chipButtons = buttons.filter((b) => b.title && b.title.length > 20);
    expect(chipButtons.length).toBeGreaterThan(0);
  });

  it('renders the ChatInput component', () => {
    render(<ChatPanel />);
    // ChatInput renders a textarea with aria-label "Chat message"
    expect(screen.getByLabelText('Chat message')).toBeDefined();
  });

  it('renders conversation switcher', () => {
    render(<ChatPanel />);
    // ConversationList renders a button with "New Chat" or similar
    expect(screen.getByLabelText('Switch conversation')).toBeDefined();
  });

  it('shows streaming indicator when isStreaming is true', () => {
    mockChatState.isStreaming = true;
    mockChatState.messages = [
      { id: 'msg-1', role: 'user', content: 'Build me a game', timestamp: Date.now() },
    ];
    render(<ChatPanel />);
    // StreamingIndicator renders a pulsing dot and status text
    expect(screen.getByText('Thinking...')).toBeDefined();
  });

  it('shows agentic loop status text when loopIteration > 0', () => {
    mockChatState.isStreaming = true;
    mockChatState.loopIteration = 2;
    mockChatState.messages = [
      { id: 'msg-1', role: 'user', content: 'Build me a game', timestamp: Date.now() },
    ];
    render(<ChatPanel />);
    expect(screen.getByText(/Step 3/)).toBeDefined();
    expect(screen.getByText('(agentic loop)')).toBeDefined();
  });

  it('shows executing tool status text when there are pending tool calls', () => {
    mockChatState.isStreaming = true;
    mockChatState.loopIteration = 0;
    mockChatState.messages = [
      {
        id: 'msg-1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [{ id: 'tc-1', name: 'update_terrain', input: {}, status: 'pending', undoable: false }],
      },
    ];
    render(<ChatPanel />);
    expect(screen.getByText(/Executing update terrain/)).toBeDefined();
  });

  it('shows error banner with role="alert" when error is set', () => {
    mockChatState.error = 'Something went wrong with the AI request';
    render(<ChatPanel />);
    const alert = screen.getByRole('alert');
    expect(alert).toBeDefined();
    expect(alert.textContent).toContain('Something went wrong');
  });

  it('does not show error banner when error is null', () => {
    mockChatState.error = null;
    render(<ChatPanel />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows clear chat button when messages are present', () => {
    mockChatState.messages = [
      { id: 'msg-1', role: 'user', content: 'Hello', timestamp: Date.now() },
    ];
    render(<ChatPanel />);
    expect(screen.getByLabelText('Clear chat')).toBeDefined();
  });

  it('does not show clear chat button when there are no messages', () => {
    mockChatState.messages = [];
    render(<ChatPanel />);
    expect(screen.queryByLabelText('Clear chat')).toBeNull();
  });

  it('calls clearChat when clear chat button is clicked', () => {
    mockChatState.messages = [
      { id: 'msg-1', role: 'user', content: 'Hello', timestamp: Date.now() },
    ];
    render(<ChatPanel />);
    fireEvent.click(screen.getByLabelText('Clear chat'));
    expect(mockClearChat).toHaveBeenCalledOnce();
  });

  it('shows session token counter when total tokens > 0', () => {
    mockChatState.sessionTokens = { input: 500, output: 300 };
    render(<ChatPanel />);
    expect(screen.getByTitle('Session token usage')).toBeDefined();
    expect(screen.getByText('800 tokens')).toBeDefined();
  });

  it('does not show session token counter when total is 0', () => {
    mockChatState.sessionTokens = { input: 0, output: 0 };
    render(<ChatPanel />);
    expect(screen.queryByTitle('Session token usage')).toBeNull();
  });
});
