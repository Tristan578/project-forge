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

// The real `getTree` — it is the prototype-chain guard itself, so stubbing it
// here would let the mock drift from the guard under test.
vi.mock('@/stores/dialogueStore', async () => ({
  getTree: (await vi.importActual<typeof import('@/stores/dialogueStore')>(
    '@/stores/dialogueStore',
  )).getTree,
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

/**
 * A tree the runtime will actually walk. `variables` and `startNodeId` are both
 * required by `DialogueTree`, and `getTree` refuses a tree missing either — a
 * fixture that omits one is not a smaller tree, it is one the component correctly
 * declines to render, which makes every assertion below fail for the wrong reason.
 * `startNodeId` in particular is rendered as a string by the editor, so a tree
 * without one is not walkable no matter how well-formed its nodes are.
 */
function fixtureTree(...nodes: (typeof textNode | typeof choiceNode)[]) {
  return {
    nodes,
    variables: {},
    startNodeId: nodes[0]?.id ?? 'node-1',
  } as unknown as { nodes: typeof textNode[] };
}

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
      dialogueTrees: { 'tree-1': fixtureTree(textNode) },
      typewriterComplete: true,
    });
    render(<DialogueOverlay />);
    expect(screen.getByText('Hero')).toBeDefined();
  });

  it('renders nothing rather than throwing when activeTreeId names an inherited property', () => {
    // `activeTreeId` traces back to a generated tree, so `dialogueTrees['__proto__']`
    // is reachable. It is truthy, so the bare lookup handed `Object.prototype` to
    // `tree.nodes.find(...)` and the overlay crashed the play surface. `getTree`
    // gates on `Object.hasOwn`, so this resolves to null and the overlay bails.
    setupDialogueStore({
      isActive: true,
      currentNodeId: 'node-1',
      activeTreeId: '__proto__',
      dialogueTrees: {},
      typewriterComplete: true,
    });
    expect(() => render(<DialogueOverlay />)).not.toThrow();
    expect(screen.queryByText('Hero')).toBeNull();
  });

  it('says the conversation cannot continue rather than painting an empty box', () => {
    // Not throwing is only half of it. Every content block is gated on the current
    // node while the box itself renders on `isActive` alone, so a tree that has
    // gone unreadable underneath a running dialogue used to leave a bordered shell
    // with nothing in it but the Esc bar — indistinguishable from a hang, and the
    // author's only recourse was to guess that Esc would close it.
    setupDialogueStore({
      isActive: true,
      currentNodeId: 'node-1',
      activeTreeId: '__proto__',
      dialogueTrees: {},
      typewriterComplete: true,
    });
    render(<DialogueOverlay />);

    expect(screen.getByText(/can't continue/i)).toBeInTheDocument();
  });

  it('does not show that message when there is a node to render', () => {
    // Without this the message above could be rendered unconditionally and every
    // ordinary line of dialogue would carry a failure notice under it.
    setupDialogueStore({
      isActive: true,
      currentNodeId: 'node-1',
      activeTreeId: 'tree-1',
      dialogueTrees: { 'tree-1': fixtureTree(textNode) },
      typewriterComplete: true,
    });
    render(<DialogueOverlay />);

    expect(screen.queryByText(/can't continue/i)).toBeNull();
  });

  it('renders dialogue text content', () => {
    setupDialogueStore({
      isActive: true,
      currentNodeId: 'node-1',
      activeTreeId: 'tree-1',
      dialogueTrees: { 'tree-1': fixtureTree(textNode) },
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
      dialogueTrees: { 'tree-1': fixtureTree(textNode, choiceNode) },
      typewriterComplete: true,
      currentChoices: [{ id: 'choice-1', text: 'Enter' }],
    });
    render(<DialogueOverlay />);
    expect(screen.getByText('Enter')).toBeDefined();
  });

  it('calls selectChoice when choice button clicked', () => {
    setupDialogueStore({
      isActive: true,
      currentNodeId: 'node-2',
      activeTreeId: 'tree-1',
      dialogueTrees: { 'tree-1': fixtureTree(textNode, choiceNode) },
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
      dialogueTrees: { 'tree-1': fixtureTree(textNode) },
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
      dialogueTrees: { 'tree-1': fixtureTree(textNode) },
      typewriterComplete: true,
      history: [{ speaker: 'Hero', text: 'Hello' }],
    });
    render(<DialogueOverlay />);
    fireEvent.click(screen.getByText('H — History'));
    expect(screen.getByText('Dialogue History')).toBeDefined();
  });

  it('shows Space to continue hint when typewriter is done', () => {
    setupDialogueStore({
      isActive: true,
      currentNodeId: 'node-1',
      activeTreeId: 'tree-1',
      dialogueTrees: { 'tree-1': fixtureTree(textNode) },
      typewriterComplete: true,
    });
    render(<DialogueOverlay />);
    expect(screen.getByText(/Space to continue/)).toBeDefined();
  });
});
