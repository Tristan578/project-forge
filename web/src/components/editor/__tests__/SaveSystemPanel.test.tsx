import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { SaveSystemPanel } from '../SaveSystemPanel';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
}));

vi.mock('@/lib/ai/saveSystemGenerator', () => ({
  analyzeSaveNeeds: vi.fn(() => [
    { path: 'player.health', type: 'number', required: true, defaultValue: 100 },
    { path: 'player.position', type: 'object', required: false, defaultValue: null },
    { path: 'inventory.items', type: 'array', required: false, defaultValue: [] },
  ]),
  validateSaveSystemConfig: vi.fn(() => []),
  saveSystemToScript: vi.fn(() => '// Generated save system script\nconst save = () => {};'),
  generateDefaultUISpecs: vi.fn(() => []),
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});

import { useEditorStore } from '@/stores/editorStore';
import { analyzeSaveNeeds, validateSaveSystemConfig } from '@/lib/ai/saveSystemGenerator';

function mockStore(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    sceneGraph: { nodes: {} },
    allGameComponents: {},
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(state));
}

describe('SaveSystemPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore();
  });

  afterEach(() => cleanup());

  it('renders the Save System Generator heading', () => {
    render(<SaveSystemPanel />);
    expect(screen.getByText('Save System Generator')).toBeInTheDocument();
  });

  it('renders the step 1 Analyze Scene section', () => {
    render(<SaveSystemPanel />);
    expect(screen.getByText('1. Analyze Scene')).toBeInTheDocument();
    expect(screen.getByText('Analyze Scene')).toBeInTheDocument();
  });

  it('renders configuration inputs for save slots and auto-save', () => {
    render(<SaveSystemPanel />);
    expect(screen.getByText('Save Slots')).toBeInTheDocument();
    expect(screen.getByText('Auto-save (sec)')).toBeInTheDocument();
    expect(screen.getByText('Enable compression')).toBeInTheDocument();
  });

  it('calls analyzeSaveNeeds when Analyze Scene button is clicked', () => {
    const mockSceneGraph = {
      nodes: { 'ent-1': { entityId: 'ent-1', name: 'Player', components: [] } },
    };
    mockStore({ sceneGraph: mockSceneGraph, allGameComponents: { 'ent-1': [{ type: 'Health' }] } });
    render(<SaveSystemPanel />);

    fireEvent.click(screen.getByText('Analyze Scene'));

    expect(vi.mocked(analyzeSaveNeeds)).toHaveBeenCalledOnce();
  });

  it('displays detected fields after analysis', () => {
    render(<SaveSystemPanel />);
    fireEvent.click(screen.getByText('Analyze Scene'));
    expect(screen.getByText('3 field(s) detected')).toBeInTheDocument();
    expect(screen.getByText('player.health')).toBeInTheDocument();
    expect(screen.getByText('player.position')).toBeInTheDocument();
  });

  it('shows field types alongside detected fields', () => {
    render(<SaveSystemPanel />);
    fireEvent.click(screen.getByText('Analyze Scene'));
    expect(screen.getByText('number')).toBeInTheDocument();
    expect(screen.getAllByText('object').length).toBeGreaterThanOrEqual(1);
  });

  it('save slots input defaults to 3', () => {
    render(<SaveSystemPanel />);
    const inputs = screen.getAllByRole('spinbutton');
    const saveSlotsInput = inputs[0] as HTMLInputElement;
    expect(saveSlotsInput.value).toBe('3');
  });

  it('auto-save interval defaults to 60', () => {
    render(<SaveSystemPanel />);
    const inputs = screen.getAllByRole('spinbutton');
    const autoSaveInput = inputs[1] as HTMLInputElement;
    expect(autoSaveInput.value).toBe('60');
  });

  it('save slots input does not produce NaN when cleared and re-typed', () => {
    render(<SaveSystemPanel />);
    const inputs = screen.getAllByRole('spinbutton');
    const saveSlotsInput = inputs[0] as HTMLInputElement;
    // Setting to empty string maps to Number('') which is 0 (not NaN)
    fireEvent.change(saveSlotsInput, { target: { value: '' } });
    // Number('') === 0, not NaN — verify the state accepts the input without crashing
    expect(Number.isNaN(saveSlotsInput.valueAsNumber)).toBe(false);

    // Setting to a valid number should work
    fireEvent.change(saveSlotsInput, { target: { value: '5' } });
    expect(saveSlotsInput.value).toBe('5');
  });

  it('auto-save interval does not produce NaN when set to 0', () => {
    render(<SaveSystemPanel />);
    const inputs = screen.getAllByRole('spinbutton');
    const autoSaveInput = inputs[1] as HTMLInputElement;
    fireEvent.change(autoSaveInput, { target: { value: '0' } });
    expect(autoSaveInput.value).toBe('0');
    expect(Number.isNaN(Number(autoSaveInput.value))).toBe(false);
  });

  it('adds a checkpoint when Add button is clicked', () => {
    render(<SaveSystemPanel />);
    const addBtn = screen.getByLabelText('Add checkpoint');
    fireEvent.click(addBtn);
    expect(screen.getByText('Checkpoint 1')).toBeInTheDocument();
  });

  it('removes a checkpoint when the remove button is clicked', () => {
    render(<SaveSystemPanel />);
    fireEvent.click(screen.getByLabelText('Add checkpoint'));
    expect(screen.getByText('Checkpoint 1')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Remove checkpoint Checkpoint 1'));
    expect(screen.queryByText('Checkpoint 1')).toBeNull();
  });

  it('shows empty checkpoint message when no checkpoints exist', () => {
    render(<SaveSystemPanel />);
    expect(screen.getByText(/No checkpoints yet/)).toBeInTheDocument();
  });

  it('shows validation errors when validateSaveSystemConfig returns errors', () => {
    vi.mocked(validateSaveSystemConfig).mockReturnValue([
      'Save slots must be between 1 and 20',
    ]);
    render(<SaveSystemPanel />);
    fireEvent.click(screen.getByText('Generate Save System'));
    expect(screen.getByText('Save slots must be between 1 and 20')).toBeInTheDocument();
  });

  it('shows generated script after successful generation', () => {
    vi.mocked(validateSaveSystemConfig).mockReturnValue([]);
    render(<SaveSystemPanel />);
    fireEvent.click(screen.getByText('Analyze Scene'));
    fireEvent.click(screen.getByText('Generate Save System'));
    expect(screen.getByText('Generated Script')).toBeInTheDocument();
    // The script is rendered in a <pre> block; match partial content
    expect(screen.getByText((content) => content.includes('Generated save system script'))).toBeInTheDocument();
  });

  it('shows Copy Script to Clipboard button after generation', () => {
    vi.mocked(validateSaveSystemConfig).mockReturnValue([]);
    render(<SaveSystemPanel />);
    fireEvent.click(screen.getByText('Analyze Scene'));
    fireEvent.click(screen.getByText('Generate Save System'));
    expect(screen.getByText('Copy Script to Clipboard')).toBeInTheDocument();
  });

  // Regression: #7097 — addCheckpoint generates duplicate IDs after deletion
  it('checkpoint IDs are unique after delete-then-add cycle (regression #7097)', () => {
    render(<SaveSystemPanel />);
    const addBtn = screen.getByLabelText('Add checkpoint');

    // Add two checkpoints
    fireEvent.click(addBtn);
    fireEvent.click(addBtn);
    expect(screen.getByText('Checkpoint 1')).toBeInTheDocument();
    expect(screen.getByText('Checkpoint 2')).toBeInTheDocument();

    // Remove checkpoint 1
    fireEvent.click(screen.getByLabelText('Remove checkpoint Checkpoint 1'));
    expect(screen.queryByText('Checkpoint 1')).toBeNull();
    expect(screen.getByText('Checkpoint 2')).toBeInTheDocument();

    // Add a new checkpoint — must NOT reuse "Checkpoint 1" ID (which would be cp_1 if array-length based)
    fireEvent.click(addBtn);
    // The new checkpoint must have a different name from any previously deleted checkpoint
    // With monotonic counter it becomes Checkpoint 3, not Checkpoint 1
    expect(screen.queryByText('Checkpoint 1')).toBeNull();
    expect(screen.getByText('Checkpoint 3')).toBeInTheDocument();
  });
});
