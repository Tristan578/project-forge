/**
 * Render tests for SuggestionChips component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { SuggestionChips } from '../SuggestionChips';
import { useEditorStore } from '@/stores/editorStore';
import { useChatStore } from '@/stores/chatStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('@/stores/chatStore', () => ({
  useChatStore: vi.fn(() => ({})),
}));

vi.mock('@/lib/chat/suggestions', () => ({
  generateSuggestions: vi.fn(() => []),
}));

vi.mock('lucide-react', () => ({
  Sparkles: (props: Record<string, unknown>) => <span data-testid="sparkles-icon" {...props} />,
}));

describe('SuggestionChips', () => {
  const mockSendMessage = vi.fn();

  function setupStores({ isStreaming = false } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        sceneGraph: [],
        selectedIds: [] as string[],
        primaryId: null as string | null,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useChatStore).mockImplementation((selector: any) => {
      const state = {
        messages: [],
        sendMessage: mockSendMessage,
        isStreaming,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupStores();
  });

  afterEach(() => {
    cleanup();
  });

  it('returns null when no suggestions', () => {
    const { container } = render(<SuggestionChips />);
    expect(container.firstChild).toBeNull();
  });

  it('renders suggestion chips from override prop', () => {
    setupStores();
    render(
      <SuggestionChips
        suggestions={[
          { label: 'Add a cube', prompt: 'Add a cube to the scene' },
          { label: 'Set lighting', prompt: 'Set up dramatic lighting' },
        ]}
      />
    );
    expect(screen.getByText('Add a cube')).toBeDefined();
    expect(screen.getByText('Set lighting')).toBeDefined();
  });

  it('calls sendMessage when chip clicked', () => {
    setupStores();
    render(
      <SuggestionChips
        suggestions={[{ label: 'Add a cube', prompt: 'Add a cube to the scene' }]}
      />
    );
    fireEvent.click(screen.getByText('Add a cube'));
    expect(mockSendMessage).toHaveBeenCalledWith('Add a cube to the scene');
  });

  it('disables chips when isStreaming is true', () => {
    setupStores({ isStreaming: true });
    render(
      <SuggestionChips
        suggestions={[{ label: 'Add a cube', prompt: 'Add a cube to the scene' }]}
      />
    );
    const button = screen.getByText('Add a cube').closest('button');
    expect(button?.disabled).toBe(true);
  });

  it('shows sparkles icon for each chip', () => {
    setupStores();
    render(
      <SuggestionChips
        suggestions={[
          { label: 'Add a cube', prompt: 'Add a cube to the scene' },
          { label: 'Set lighting', prompt: 'Set lighting' },
        ]}
      />
    );
    const icons = screen.getAllByTestId('sparkles-icon');
    expect(icons.length).toBe(2);
  });

  it('chip title matches the prompt', () => {
    setupStores();
    render(
      <SuggestionChips
        suggestions={[{ label: 'Add a cube', prompt: 'Add a cube to the scene' }]}
      />
    );
    const button = screen.getByText('Add a cube').closest('button');
    expect(button?.getAttribute('title')).toBe('Add a cube to the scene');
  });
});
