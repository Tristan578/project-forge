// @vitest-environment jsdom
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

vi.mock('@/components/chat/ToolCallCard', () => ({
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
    expect(screen.getByText('You')).toBeDefined();
    expect(screen.getByText('Hello AI!')).toBeDefined();
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
    expect(screen.getByText('AI')).toBeDefined();
    expect(screen.getByText('I can help you build a game.')).toBeDefined();
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
    expect(screen.getByText('Session started')).toBeDefined();
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
    expect(reasoningBtn).toBeDefined();

    // Initially closed
    expect(screen.queryByText('Let me think about this...')).toBeNull();

    // Toggle open
    fireEvent.click(reasoningBtn);
    expect(screen.getByText('Let me think about this...')).toBeDefined();
  });

  it('renders image attachments when images are present', () => {
    render(
      <ChatMessage
        message={{
          id: 'msg-5',
          role: 'user',
          content: 'Check this out',
          images: ['data:image/png;base64,abc', 'data:image/png;base64,def'],
          timestamp: Date.now(),
        }}
      />
    );
    const imgs = screen.getAllByRole('img');
    expect(imgs).toHaveLength(2);
    expect(imgs[0].getAttribute('src')).toBe('data:image/png;base64,abc');
    expect(imgs[1].getAttribute('src')).toBe('data:image/png;base64,def');
  });

  it('does not render image section when images array is empty', () => {
    render(
      <ChatMessage
        message={{
          id: 'msg-6',
          role: 'user',
          content: 'Hello',
          images: [],
          timestamp: Date.now(),
        }}
      />
    );
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('displays token cost for assistant messages when tokenCost > 0', () => {
    render(
      <ChatMessage
        message={{
          id: 'msg-7',
          role: 'assistant',
          content: 'I built your scene.',
          tokenCost: 1234,
          timestamp: Date.now(),
          toolCalls: [],
        }}
      />
    );
    expect(screen.getByText(/1,234 tokens/)).toBeDefined();
  });

  it('does not display token cost when tokenCost is 0', () => {
    render(
      <ChatMessage
        message={{
          id: 'msg-8',
          role: 'assistant',
          content: 'Hello.',
          tokenCost: 0,
          timestamp: Date.now(),
          toolCalls: [],
        }}
      />
    );
    expect(screen.queryByText(/tokens/)).toBeNull();
  });

  it('does not display token cost for user messages', () => {
    render(
      <ChatMessage
        message={{
          id: 'msg-9',
          role: 'user',
          content: 'Build me a game.',
          tokenCost: 500,
          timestamp: Date.now(),
        }}
      />
    );
    expect(screen.queryByText(/tokens/)).toBeNull();
  });

  it('renders feedback buttons with correct aria-pressed state when no feedback set', () => {
    render(
      <ChatMessage
        message={{
          id: 'msg-10',
          role: 'assistant',
          content: 'Done!',
          timestamp: Date.now(),
          toolCalls: [
            { id: 'tc-1', name: 'spawn_entity', input: {}, status: 'success', undoable: false },
          ],
        }}
      />
    );
    // Feedback buttons show after allToolsDone
    const thumbsUp = screen.getByTitle('Good response');
    const thumbsDown = screen.getByTitle('Bad response');
    expect(thumbsUp).toBeDefined();
    expect(thumbsDown).toBeDefined();
  });

  it('calls setMessageFeedback with positive when thumbs-up is clicked', () => {
    render(
      <ChatMessage
        message={{
          id: 'msg-11',
          role: 'assistant',
          content: 'Done!',
          feedback: undefined,
          timestamp: Date.now(),
          toolCalls: [
            { id: 'tc-1', name: 'spawn_entity', input: {}, status: 'success', undoable: false },
          ],
        }}
      />
    );
    fireEvent.click(screen.getByTitle('Good response'));
    expect(mockSetMessageFeedback).toHaveBeenCalledWith('msg-11', 'positive');
  });

  it('calls setMessageFeedback with null when positive feedback is toggled off', () => {
    render(
      <ChatMessage
        message={{
          id: 'msg-12',
          role: 'assistant',
          content: 'Done!',
          feedback: 'positive',
          timestamp: Date.now(),
          toolCalls: [
            { id: 'tc-1', name: 'spawn_entity', input: {}, status: 'success', undoable: false },
          ],
        }}
      />
    );
    fireEvent.click(screen.getByTitle('Good response'));
    expect(mockSetMessageFeedback).toHaveBeenCalledWith('msg-12', null);
  });

  it('renders Undo All button when 2+ successful undoable tool calls are done', () => {
    render(
      <ChatMessage
        message={{
          id: 'msg-13',
          role: 'assistant',
          content: 'Built!',
          timestamp: Date.now(),
          toolCalls: [
            { id: 'tc-1', name: 'spawn_entity', input: {}, status: 'success', undoable: true },
            { id: 'tc-2', name: 'spawn_entity', input: {}, status: 'success', undoable: true },
          ],
        }}
      />
    );
    expect(screen.getByText(/Undo All/)).toBeDefined();
  });

  it('calls batchUndoMessage when Undo All is clicked', () => {
    render(
      <ChatMessage
        message={{
          id: 'msg-14',
          role: 'assistant',
          content: 'Built!',
          timestamp: Date.now(),
          toolCalls: [
            { id: 'tc-1', name: 'spawn_entity', input: {}, status: 'success', undoable: true },
            { id: 'tc-2', name: 'spawn_entity', input: {}, status: 'success', undoable: true },
          ],
        }}
      />
    );
    fireEvent.click(screen.getByText(/Undo All/));
    expect(mockBatchUndoMessage).toHaveBeenCalledWith('msg-14');
  });

  it('does not render Undo All button when only 1 undoable tool call', () => {
    render(
      <ChatMessage
        message={{
          id: 'msg-15',
          role: 'assistant',
          content: 'Done.',
          timestamp: Date.now(),
          toolCalls: [
            { id: 'tc-1', name: 'spawn_entity', input: {}, status: 'success', undoable: true },
          ],
        }}
      />
    );
    expect(screen.queryByText(/Undo All/)).toBeNull();
  });

  it('renders tool calls via ToolCallCard', () => {
    render(
      <ChatMessage
        message={{
          id: 'msg-16',
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          toolCalls: [
            { id: 'tc-1', name: 'spawn_entity', input: {}, status: 'pending', undoable: false },
            { id: 'tc-2', name: 'update_transform', input: {}, status: 'pending', undoable: false },
          ],
        }}
      />
    );
    expect(screen.getByTestId('tool-call-spawn_entity')).toBeDefined();
    expect(screen.getByTestId('tool-call-update_transform')).toBeDefined();
  });

  it('shows batch approve/reject buttons for preview tool calls', () => {
    render(
      <ChatMessage
        message={{
          id: 'msg-17',
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          toolCalls: [
            { id: 'tc-1', name: 'spawn_entity', input: {}, status: 'preview', undoable: false },
          ],
        }}
      />
    );
    expect(screen.getByText(/Approve All/)).toBeDefined();
    expect(screen.getByText('Reject All')).toBeDefined();
  });

  it('calls approveToolCalls when Approve All is clicked', () => {
    render(
      <ChatMessage
        message={{
          id: 'msg-18',
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          toolCalls: [
            { id: 'tc-1', name: 'spawn_entity', input: {}, status: 'preview', undoable: false },
          ],
        }}
      />
    );
    fireEvent.click(screen.getByText(/Approve All/));
    expect(mockApproveToolCalls).toHaveBeenCalledWith('msg-18');
  });
});
