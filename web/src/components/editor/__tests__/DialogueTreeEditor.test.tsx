/**
 * Tests for DialogueTreeEditor — tree selection, creation, deletion,
 * node rendering, node expansion, add node menu.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { DialogueTreeEditor } from '../DialogueTreeEditor';
import { useDialogueStore } from '@/stores/dialogueStore';

vi.mock('@/stores/dialogueStore', () => ({
  useDialogueStore: vi.fn(() => ({})),
}));

const mockSelectTree = vi.fn();
const mockAddTree = vi.fn(() => 'tree-new');
const mockRemoveTree = vi.fn();
const mockDuplicateTree = vi.fn();
const mockUpdateTree = vi.fn();
const mockUpdateNode = vi.fn();
const mockRemoveNode = vi.fn();
const mockAddNode = vi.fn();
const mockSelectNode = vi.fn();
const mockLoadFromLocalStorage = vi.fn();

const textNode = { id: 'node-1', type: 'text' as const, speaker: 'NPC', text: 'Hello traveler, welcome to the village.', next: null };
const choiceNode = { id: 'node-2', type: 'choice' as const, choices: [{ id: 'ch-1', text: 'Accept', nextNodeId: null }, { id: 'ch-2', text: 'Decline', nextNodeId: null }] };
const endNode = { id: 'node-3', type: 'end' as const };

const mockTree = {
  id: 'tree-1',
  name: 'Main Quest',
  startNodeId: 'node-1',
  nodes: [textNode, choiceNode, endNode],
};

function setupStore(overrides: {
  selectedTreeId?: string | null;
  selectedNodeId?: string | null;
  dialogueTrees?: Record<string, typeof mockTree>;
} = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useDialogueStore).mockImplementation((selector: any) => {
    const state = {
      dialogueTrees: overrides.dialogueTrees ?? { 'tree-1': mockTree },
      selectedTreeId: overrides.selectedTreeId ?? 'tree-1',
      selectedNodeId: overrides.selectedNodeId ?? null,
      selectTree: mockSelectTree,
      addTree: mockAddTree,
      removeTree: mockRemoveTree,
      duplicateTree: mockDuplicateTree,
      updateTree: mockUpdateTree,
      updateNode: mockUpdateNode,
      removeNode: mockRemoveNode,
      addNode: mockAddNode,
      selectNode: mockSelectNode,
      loadFromLocalStorage: mockLoadFromLocalStorage,
    };
    return selector(state);
  });
}

describe('DialogueTreeEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Basic rendering ───────────────────────────────────────────────────

  it('renders Dialogue Editor header', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    expect(screen.getByText('Dialogue Editor')).toBeInTheDocument();
  });

  it('calls loadFromLocalStorage on mount', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    expect(mockLoadFromLocalStorage).toHaveBeenCalled();
  });

  // ── No tree selected ──────────────────────────────────────────────────

  it('shows empty state when no tree selected', () => {
    setupStore({ selectedTreeId: null, dialogueTrees: {} });
    render(<DialogueTreeEditor />);
    expect(screen.getByText(/Select or create/)).toBeInTheDocument();
  });

  // ── Tree selector ─────────────────────────────────────────────────────

  it('renders tree selector dropdown', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    const select = document.querySelector('select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('tree-1');
  });

  it('shows tree name in dropdown', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    expect(screen.getByText('Main Quest')).toBeInTheDocument();
  });

  it('selects tree on dropdown change', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    const select = document.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '' } });
    expect(mockSelectTree).toHaveBeenCalledWith(null);
  });

  it('creates new tree on + button click', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    fireEvent.click(screen.getByTitle('New Tree'));
    expect(mockAddTree).toHaveBeenCalledWith('New Dialogue');
    expect(mockSelectTree).toHaveBeenCalledWith('tree-new');
  });

  it('deletes tree on delete button click', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    fireEvent.click(screen.getByTitle('Delete Tree'));
    expect(mockRemoveTree).toHaveBeenCalledWith('tree-1');
    expect(mockSelectTree).toHaveBeenCalledWith(null);
  });

  it('duplicates tree on duplicate button click', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    fireEvent.click(screen.getByTitle('Duplicate'));
    expect(mockDuplicateTree).toHaveBeenCalledWith('tree-1');
  });

  // ── Tree name editor ──────────────────────────────────────────────────

  it('renders tree name input', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    expect(screen.getByText('Tree Name')).toBeInTheDocument();
    const nameInputs = screen.getAllByDisplayValue('Main Quest');
    // One in select, one in text input
    expect(nameInputs.length).toBeGreaterThanOrEqual(1);
  });

  it('updates tree name on input change', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    // The text input is the one with type="text" (not the select)
    const textInput = document.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.change(textInput, { target: { value: 'Side Quest' } });
    expect(mockUpdateTree).toHaveBeenCalledWith('tree-1', { name: 'Side Quest' });
  });

  // ── Node list ─────────────────────────────────────────────────────────

  it('shows node count and start node', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    expect(screen.getByText(/3 nodes/)).toBeInTheDocument();
  });

  it('renders text node with label', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    // Label wraps text in quotes
    expect(screen.getByText(/Hello traveler, welcome to the village/)).toBeInTheDocument();
  });

  it('renders choice node with choice count', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    expect(screen.getByText('2 choices')).toBeInTheDocument();
  });

  it('renders end node', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    expect(screen.getByText('End')).toBeInTheDocument();
  });

  it('shows START badge on start node', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    expect(screen.getByText('START')).toBeInTheDocument();
  });

  it('selects node on click', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    fireEvent.click(screen.getByText(/Hello traveler, welcome to the village/));
    expect(mockSelectNode).toHaveBeenCalledWith('node-1');
  });

  it('removes node on delete button', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    // Each node has a delete button (Trash2 icon)
    const deleteButtons = document.querySelectorAll('[class*="hover\\:text-red-400"]');
    // First delete button is for the first node
    fireEvent.click(deleteButtons[0]);
    expect(mockRemoveNode).toHaveBeenCalledWith('tree-1', 'node-1');
  });

  // ── Add node menu ─────────────────────────────────────────────────────

  it('renders Add Node button', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    expect(screen.getByText('Add Node')).toBeInTheDocument();
  });

  it('opens add node menu on click', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    fireEvent.click(screen.getByText('Add Node'));
    // CSS capitalize means DOM text is lowercase + " Node"
    expect(screen.getByText('text Node')).toBeInTheDocument();
    expect(screen.getByText('choice Node')).toBeInTheDocument();
    expect(screen.getByText('condition Node')).toBeInTheDocument();
    expect(screen.getByText('action Node')).toBeInTheDocument();
    expect(screen.getByText('end Node')).toBeInTheDocument();
  });

  it('adds text node from menu', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    fireEvent.click(screen.getByText('Add Node'));
    fireEvent.click(screen.getByText('text Node'));
    expect(mockAddNode).toHaveBeenCalledWith(
      'tree-1',
      expect.objectContaining({ type: 'text', speaker: 'NPC' }),
    );
    expect(mockSelectNode).toHaveBeenCalled();
  });

  it('adds end node from menu', () => {
    setupStore();
    render(<DialogueTreeEditor />);
    fireEvent.click(screen.getByText('Add Node'));
    fireEvent.click(screen.getByText('end Node'));
    expect(mockAddNode).toHaveBeenCalledWith(
      'tree-1',
      expect.objectContaining({ type: 'end' }),
    );
  });
});
