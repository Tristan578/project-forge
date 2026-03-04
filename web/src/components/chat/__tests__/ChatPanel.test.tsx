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
}));

const mockClearChat = vi.fn();
const mockSendMessage = vi.fn();

vi.mock('@/stores/chatStore', () => ({
  useChatStore: Object.assign(
    vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
      selector({
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
      })
    ),
    { setState: vi.fn(), getState: vi.fn() },
  ),
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      sceneGraph: { nodes: {} },
      selectEntity: vi.fn(),
      undo: vi.fn(),
    })
  ),
}));

describe('ChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    render(<ChatPanel />);
    expect(screen.getByText('AI Assistant')).toBeDefined();
  });

  it('shows suggested prompts when no messages', () => {
    render(<ChatPanel />);
    expect(screen.getByText('Describe what you want to build.')).toBeDefined();
    expect(screen.getByText('Build a simple platformer level')).toBeDefined();
  });

  it('sends a message when a suggested prompt is clicked', () => {
    render(<ChatPanel />);
    const promptBtn = screen.getByText('Add realistic lighting to my scene');
    fireEvent.click(promptBtn);
    expect(mockSendMessage).toHaveBeenCalledWith('Add realistic lighting to my scene');
  });

  it('renders the ChatInput component', () => {
    render(<ChatPanel />);
    // ChatInput renders a textarea with aria-label "Chat message"
    expect(screen.getByLabelText('Chat message')).toBeDefined();
  });
});
