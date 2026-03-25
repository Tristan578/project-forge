/**
 * Render tests for DialogueOverlay component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { DialogueOverlay } from '../DialogueOverlay';
import { useDialogueStore } from '@/stores/dialogueStore';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/dialogueStore', () => ({
  useDialogueStore: vi.fn(() => ({})),
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  MessageSquare: (props: Record<string, unknown>) => <span data-testid="message-square" {...props} />,
  ChevronRight: (props: Record<string, unknown>) => <span data-testid="chevron-right" {...props} />,
  History: (props: Record<string, unknown>) => <span data-testid="history-icon" {...props} />,
}));

const textNode = {
  id: 'node-1',
  type: 'text' as const,
  speaker: 'Hero',
  text: 'Welcome to the dungeon!',
};

const choiceNode = {
  id: 'node-2',
  type: 'choice' as const,
  speaker: 'Guide',
  choices: [{ id: 'choice-1', text: 'Enter', targetNodeId: null }],
};

describe('DialogueOverlay', () => {
  const mockAdvanceDialogue = vi.fn();
  const mockSelectChoice = vi.fn();
  const mockSkipTypewriter = vi.fn();
  const mockEndDialogue = vi.fn();

  function setupDialogueStore({
    isActive = false,
    currentNodeId = null as string | null,
    activeTreeId = null as string | null,
    dialogueTrees = {} as Record<string, { nodes: typeof textNode[] }>,
    typewriterComplete = true,
    displayedText = '',
    currentChoices = [] as { id: string; text: string }[],
    history = [] as { speaker: string; text: string }[],
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useDialogueStore).mockImplementation((selector: any) => {
      const state = {
        runtime: {
          isActive,
          currentNodeId,
          activeTreeId,
          typewriterComplete,
          displayedText,
          currentChoices,
          history,
        },
        dialogueTrees,
        advanceDialogue: mockAdvanceDialogue,
        selectChoice: mockSelectChoice,
        skipTypewriter: mockSkipTypewriter,
        endDialogue: mockEndDialogue,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  function setupEditorStore({ engineMode = 'edit' as string } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = { engineMode };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupEditorStore({ engineMode: 'play' });
  });

  afterEach(() => {
    cleanup();
  });

  it('returns null when not active', () => {
    setupDialogueStore({ isActive: false });
    const { container } = render(<DialogueOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when not in play mode', () => {
    setupDialogueStore({ isActive: true, currentNodeId: 'node-1' });
    setupEditorStore({ engineMode: 'edit' });
    const { container } = render(<DialogueOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('renders speaker name for text node', () => {
    setupDialogueStore({
      isActive: true,
      currentNodeId: 'node-1',
      activeTreeId: 'tree-1',
      dialogueTrees: { 'tree-1': { nodes: [textNode] } },
      typewriterComplete: true,
    });
    render(<DialogueOverlay />);
    expect(screen.getByText('Hero')).not.toBeNull();
  });

  it('renders dialogue text content', () => {
    setupDialogueStore({
      isActive: true,
      currentNodeId: 'node-1',
      activeTreeId: 'tree-1',
      dialogueTrees: { 'tree-1': { nodes: [textNode] } },
      typewriterComplete: true,
    });
    render(<DialogueOverlay />);
    // The typewriter hook fills typewriterText from the node's text
    // When typewriterComplete is true, it shows full text immediately
    const paragraphs = document.body.querySelectorAll('p');
    // Check that the dialogue box is rendered with some content
    expect(paragraphs.length).toBeGreaterThan(0);
  });

  it('renders choice buttons for choice node', () => {
    setupDialogueStore({
      isActive: true,
      currentNodeId: 'node-2',
      activeTreeId: 'tree-1',
      dialogueTrees: { 'tree-1': { nodes: [textNode, choiceNode as unknown as typeof textNode] } },
      typewriterComplete: true,
      currentChoices: [{ id: 'choice-1', text: 'Enter' }],
    });
    render(<DialogueOverlay />);
    expect(screen.getByText('Enter')).not.toBeNull();
  });

  it('calls selectChoice when choice button clicked', () => {
    setupDialogueStore({
      isActive: true,
      currentNodeId: 'node-2',
      activeTreeId: 'tree-1',
      dialogueTrees: { 'tree-1': { nodes: [textNode, choiceNode as unknown as typeof textNode] } },
      typewriterComplete: true,
      currentChoices: [{ id: 'choice-1', text: 'Enter' }],
    });
    render(<DialogueOverlay />);
    fireEvent.click(screen.getByText('Enter'));
    expect(mockSelectChoice).toHaveBeenCalledWith('choice-1');
  });

  it('calls endDialogue when Esc — Close button clicked', () => {
    setupDialogueStore({
      isActive: true,
      currentNodeId: 'node-1',
      activeTreeId: 'tree-1',
      dialogueTrees: { 'tree-1': { nodes: [textNode] } },
      typewriterComplete: true,
    });
    render(<DialogueOverlay />);
    fireEvent.click(screen.getByText('Esc — Close'));
    expect(mockEndDialogue).toHaveBeenCalled();
  });

  it('toggles history panel when H — History button clicked', () => {
    setupDialogueStore({
      isActive: true,
      currentNodeId: 'node-1',
      activeTreeId: 'tree-1',
      dialogueTrees: { 'tree-1': { nodes: [textNode] } },
      typewriterComplete: true,
      history: [{ speaker: 'Hero', text: 'Hello' }],
    });
    render(<DialogueOverlay />);
    fireEvent.click(screen.getByText('H — History'));
    expect(screen.getByText('Dialogue History')).not.toBeNull();
  });

  it('shows Space to continue hint when typewriter is done', () => {
    setupDialogueStore({
      isActive: true,
      currentNodeId: 'node-1',
      activeTreeId: 'tree-1',
      dialogueTrees: { 'tree-1': { nodes: [textNode] } },
      typewriterComplete: true,
    });
    render(<DialogueOverlay />);
    expect(screen.getByText(/Space to continue/)).not.toBeNull();
  });
});
