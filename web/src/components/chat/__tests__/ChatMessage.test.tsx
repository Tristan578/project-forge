import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ChatMessage } from '../ChatMessage';

vi.mock('lucide-react', () => ({
  ChevronDown: (props: Record<string, unknown>) => <span data-testid="chevron-down" {...props} />,
  ChevronRight: (props: Record<string, unknown>) => <span data-testid="chevron-right" {...props} />,
  Brain: (props: Record<string, unknown>) => <span data-testid="brain-icon" {...props} />,
  ThumbsUp: (props: Record<string, unknown>) => <span data-testid="thumbs-up" {...props} />,
  ThumbsDown: (props: Record<string, unknown>) => <span data-testid="thumbs-down" {...props} />,
  RotateCcw: (props: Record<string, unknown>) => <span data-testid="rotate-ccw" {...props} />,
  Check: (props: Record<string, unknown>) => <span data-testid="check-icon" {...props} />,
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
}));

vi.mock('./ToolCallCard', () => ({
  ToolCallCard: ({ toolCall }: { toolCall: { name: string } }) => (
    <div data-testid={`tool-call-${toolCall.name}`}>{toolCall.name}</div>
  ),
}));

const mockSetMessageFeedback = vi.fn();
const mockBatchUndoMessage = vi.fn();
const mockApproveToolCalls = vi.fn();
const mockRejectToolCalls = vi.fn();

vi.mock('@/stores/chatStore', () => ({
  useChatStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      setMessageFeedback: mockSetMessageFeedback,
      batchUndoMessage: mockBatchUndoMessage,
      approveToolCalls: mockApproveToolCalls,
      rejectToolCalls: mockRejectToolCalls,
    })
  ),
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      sceneGraph: { nodes: {} },
      selectEntity: vi.fn(),
    })
  ),
}));

describe('ChatMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a user message', () => {
    render(
      <ChatMessage
        message={{
          id: 'msg-1',
          role: 'user',
          content: 'Hello AI!',
          timestamp: Date.now(),
        }}
      />
    );
    expect(screen.getByText('You')).not.toBeNull();
    expect(screen.getByText('Hello AI!')).not.toBeNull();
  });

  it('renders an assistant message', () => {
    render(
      <ChatMessage
        message={{
          id: 'msg-2',
          role: 'assistant',
          content: 'I can help you build a game.',
          timestamp: Date.now(),
          toolCalls: [],
        }}
      />
    );
    expect(screen.getByText('AI')).not.toBeNull();
    expect(screen.getByText('I can help you build a game.')).not.toBeNull();
  });

  it('renders a system message', () => {
    render(
      <ChatMessage
        message={{
          id: 'msg-3',
          role: 'system',
          content: 'Session started',
          timestamp: Date.now(),
        }}
      />
    );
    expect(screen.getByText('Session started')).not.toBeNull();
  });

  it('renders thinking section when present and toggles it', () => {
    render(
      <ChatMessage
        message={{
          id: 'msg-4',
          role: 'assistant',
          content: 'Result',
          thinking: 'Let me think about this...',
          timestamp: Date.now(),
          toolCalls: [],
        }}
      />
    );
    const reasoningBtn = screen.getByText('Reasoning');
    expect(reasoningBtn).not.toBeNull();

    // Initially closed
    expect(screen.queryByText('Let me think about this...')).toBeNull();

    // Toggle open
    fireEvent.click(reasoningBtn);
    expect(screen.getByText('Let me think about this...')).not.toBeNull();
  });
});
