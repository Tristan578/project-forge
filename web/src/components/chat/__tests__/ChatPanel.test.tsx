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

let chatStoreOverrides: Record<string, unknown> = {};

const defaultChatState = {
  messages: [],
  isStreaming: false,
  error: null,
  clearChat: mockClearChat,
  sendMessage: mockSendMessage,
  loopIteration: 0,
  sessionTokens: { input: 0, output: 0 },
  rightPanelTab: 'chat',
  setRightPanelTab: vi.fn(),
  activeModel: 'claude-sonnet-4-6',
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
    vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
      selector({ ...defaultChatState, ...chatStoreOverrides })
    ),
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

const mockCanUseAI = vi.fn(() => true);
vi.mock('@/stores/userStore', () => ({
  useUserStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      tier: 'creator',
      canUseAI: mockCanUseAI,
    })
  ),
}));

describe('ChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatStoreOverrides = {};
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

  it('shows upgrade prompt when canUseAI is false', () => {
    mockCanUseAI.mockReturnValue(false);
    render(<ChatPanel />);
    expect(screen.getByText('AI features require a paid plan.')).toBeDefined();
    const link = screen.getByText('View plans');
    expect(link).toBeDefined();
    expect(link.getAttribute('href')).toBe('/pricing');
    // Should NOT show suggestion chips
    expect(screen.queryByText('Describe what you want to build.')).toBeNull();
  });

  it('retry button sends the last user message with all attachments', () => {
    chatStoreOverrides = {
      messages: [
        { id: '1', role: 'user', content: 'Build a castle', images: ['img1.png'], entityRefs: { e1: 'Castle' } },
        { id: '2', role: 'assistant', content: 'Sure!' },
      ],
      error: 'Connection failed',
    };
    render(<ChatPanel />);
    const retryBtn = screen.getByLabelText('Retry last message');
    fireEvent.click(retryBtn);
    expect(mockSendMessage).toHaveBeenCalledWith('Build a castle', ['img1.png'], { e1: 'Castle' });
  });
});
