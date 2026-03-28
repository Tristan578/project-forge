import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@/test/utils/componentTestUtils';
import { ModifyPanel } from '../ModifyPanel';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
  getCommandDispatcher: vi.fn(),
}));

vi.mock('@/lib/ai/sceneContext', () => ({
  buildSceneContext: vi.fn(() => ({ entities: [], selectedIds: [] })),
}));

vi.mock('@/lib/ai/gameModifier', () => ({
  planModification: vi.fn(),
  executeModificationPlan: vi.fn(() => [
    { stepIndex: 0, success: true, entityId: 'ent-1', appliedCommands: 1 },
  ]),
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});

import { useEditorStore, getCommandDispatcher } from '@/stores/editorStore';
import { planModification } from '@/lib/ai/gameModifier';

function mockStore(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    sceneGraph: { nodes: {} },
    selectedIds: new Set<string>(),
    ambientLight: null,
    environment: null,
    engineMode: 'edit',
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(state));
}

describe('ModifyPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore();
    vi.mocked(getCommandDispatcher).mockReturnValue(vi.fn());
  });

  afterEach(() => cleanup());

  it('renders the Modify Game heading', () => {
    render(<ModifyPanel />);
    expect(screen.getByText('Modify Game')).toBeDefined();
  });

  it('renders the description textarea in idle state', () => {
    render(<ModifyPanel />);
    const textarea = screen.getByLabelText('What would you like to change?');
    expect(textarea).toBeDefined();
  });

  it('Plan Changes button is disabled when description is empty', () => {
    render(<ModifyPanel />);
    const button = screen.getByText('Plan Changes');
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('Plan Changes button is enabled when description is entered', () => {
    render(<ModifyPanel />);
    fireEvent.change(screen.getByLabelText('What would you like to change?'), {
      target: { value: 'make enemies faster' },
    });
    const button = screen.getByText('Plan Changes');
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it('shows planning spinner while planModification is running', async () => {
    // planModification returns a promise that doesn't resolve immediately
    vi.mocked(planModification).mockReturnValue(new Promise(() => {}));
    render(<ModifyPanel />);
    fireEvent.change(screen.getByLabelText('What would you like to change?'), {
      target: { value: 'make enemies faster' },
    });
    fireEvent.click(screen.getByText('Plan Changes'));
    expect(screen.getByText('Analyzing scene and planning modifications...')).toBeDefined();
  });

  it('shows error message when planModification throws', async () => {
    vi.mocked(planModification).mockRejectedValue(new Error('AI service unavailable'));
    render(<ModifyPanel />);
    fireEvent.change(screen.getByLabelText('What would you like to change?'), {
      target: { value: 'make enemies faster' },
    });
    fireEvent.click(screen.getByText('Plan Changes'));
    await waitFor(() => screen.getByText('AI service unavailable'));
    expect(screen.getByText('AI service unavailable')).toBeDefined();
  });

  it('shows Try again button after error', async () => {
    vi.mocked(planModification).mockRejectedValue(new Error('Connection failed'));
    render(<ModifyPanel />);
    fireEvent.change(screen.getByLabelText('What would you like to change?'), {
      target: { value: 'change background' },
    });
    fireEvent.click(screen.getByText('Plan Changes'));
    await waitFor(() => screen.getByText('Try again'));
    expect(screen.getByText('Try again')).toBeDefined();
  });

  it('resets to idle state when Try again is clicked', async () => {
    vi.mocked(planModification).mockRejectedValue(new Error('Failed'));
    render(<ModifyPanel />);
    fireEvent.change(screen.getByLabelText('What would you like to change?'), {
      target: { value: 'make it faster' },
    });
    fireEvent.click(screen.getByText('Plan Changes'));
    await waitFor(() => screen.getByText('Try again'));
    fireEvent.click(screen.getByText('Try again'));
    // After reset, error should be gone and Plan Changes button should reappear
    expect(screen.queryByText('Try again')).toBeNull();
    expect(screen.getByText('Plan Changes')).toBeDefined();
  });

  it('shows plan summary after successful planning', async () => {
    vi.mocked(planModification).mockResolvedValue({
      summary: 'Increase enemy speed by 50%',
      steps: [
        { command: 'set_physics', entityId: 'enemy-1', params: {}, description: 'Increase speed', reversible: true },
      ],
      affectedEntities: ['enemy-1'],
      confidence: 0.92,
      scope: 'scene' as const,
    });
    render(<ModifyPanel />);
    fireEvent.change(screen.getByLabelText('What would you like to change?'), {
      target: { value: 'make enemies faster' },
    });
    fireEvent.click(screen.getByText('Plan Changes'));
    await waitFor(() => screen.getByText('Increase enemy speed by 50%'));
    expect(screen.getByText('Increase enemy speed by 50%')).toBeDefined();
    expect(screen.getByText('Confidence: 92%')).toBeDefined();
  });

  it('renders scope selector with Selected and Entire Scene buttons', () => {
    render(<ModifyPanel />);
    expect(screen.getByTitle('Only modify selected entities')).toBeDefined();
    expect(screen.getByTitle('Modify any entity in the scene')).toBeDefined();
  });

  it('toggles scope when scope buttons are clicked', () => {
    render(<ModifyPanel />);
    const selectedBtn = screen.getByTitle('Only modify selected entities');
    fireEvent.click(selectedBtn);
    expect(selectedBtn.getAttribute('aria-pressed')).toBe('true');
  });
});
