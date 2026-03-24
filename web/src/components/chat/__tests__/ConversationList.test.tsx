/**
 * Render tests for ConversationList component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ConversationList } from '../ConversationList';
import { useChatStore } from '@/stores/chatStore';

vi.mock('@/stores/chatStore', () => ({
  useChatStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  Plus: (props: Record<string, unknown>) => <span data-testid="plus-icon" {...props} />,
  Trash2: (props: Record<string, unknown>) => <span data-testid="trash-icon" {...props} />,
  ChevronDown: (props: Record<string, unknown>) => <span data-testid="chevron-down" {...props} />,
  Pencil: (props: Record<string, unknown>) => <span data-testid="pencil-icon" {...props} />,
  Check: (props: Record<string, unknown>) => <span data-testid="check-icon" {...props} />,
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
}));

const baseConversations = [
  { id: 'conv-1', name: 'My Chat', messages: [{ id: 'm1' }], updatedAt: 2000 },
  { id: 'conv-2', name: 'Another Chat', messages: [], updatedAt: 1000 },
];

describe('ConversationList', () => {
  const mockCreateConversation = vi.fn();
  const mockSwitchConversation = vi.fn();
  const mockDeleteConversation = vi.fn();
  const mockRenameConversation = vi.fn();
  const mockLoadConversations = vi.fn();

  function setupStore({
    conversations = baseConversations as typeof baseConversations,
    activeConversationId = 'conv-1' as string | null,
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useChatStore).mockImplementation((selector: any) => {
      const state = {
        conversations,
        activeConversationId,
        createConversation: mockCreateConversation,
        switchConversation: mockSwitchConversation,
        deleteConversation: mockDeleteConversation,
        renameConversation: mockRenameConversation,
        loadConversations: mockLoadConversations,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the active conversation name as button text', () => {
    render(<ConversationList />);
    expect(screen.getByText('My Chat')).not.toBeNull();
  });

  it('shows "New Chat" when no active conversation', () => {
    setupStore({ conversations: [], activeConversationId: null });
    render(<ConversationList />);
    expect(screen.getByText('New Chat')).not.toBeNull();
  });

  it('calls loadConversations on mount', () => {
    render(<ConversationList />);
    expect(mockLoadConversations).toHaveBeenCalled();
  });

  it('shows Switch conversation aria-label', () => {
    render(<ConversationList />);
    expect(screen.getByLabelText('Switch conversation')).not.toBeNull();
  });

  it('opens dropdown when button clicked', () => {
    render(<ConversationList />);
    fireEvent.click(screen.getByLabelText('Switch conversation'));
    expect(screen.getByText('New Chat')).not.toBeNull(); // New Chat button in dropdown
    expect(screen.getByText('Another Chat')).not.toBeNull();
  });

  it('shows "No saved conversations" when conversations empty', () => {
    setupStore({ conversations: [] });
    render(<ConversationList />);
    fireEvent.click(screen.getByLabelText('Switch conversation'));
    expect(screen.getByText('No saved conversations')).not.toBeNull();
  });

  it('calls createConversation when New Chat clicked', () => {
    render(<ConversationList />);
    fireEvent.click(screen.getByLabelText('Switch conversation'));
    fireEvent.click(screen.getByText('New Chat'));
    expect(mockCreateConversation).toHaveBeenCalled();
  });

  it('calls switchConversation when a conversation row clicked', () => {
    render(<ConversationList />);
    fireEvent.click(screen.getByLabelText('Switch conversation'));
    fireEvent.click(screen.getByText('Another Chat'));
    expect(mockSwitchConversation).toHaveBeenCalledWith('conv-2');
  });

  it('shows message count for each conversation', () => {
    render(<ConversationList />);
    fireEvent.click(screen.getByLabelText('Switch conversation'));
    expect(screen.getByText('1 msg')).not.toBeNull();
    expect(screen.getByText('0 msgs')).not.toBeNull();
  });
});
