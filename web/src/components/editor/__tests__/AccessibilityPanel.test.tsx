/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { AccessibilityPanel } from '../AccessibilityPanel';

const mockSetAccessibilityProfile = vi.fn();
const mockDispatcher = vi.fn();

vi.mock('@/stores/editorStore', () => {
  const mockGetState = vi.fn(() => ({
    sceneGraph: { nodes: {} },
    primaryMaterial: null,
    primaryLight: null,
    selectedIds: new Set<string>(),
    allScripts: {},
    inputBindings: [],
    allGameComponents: {},
    setAccessibilityProfile: mockSetAccessibilityProfile,
  }));
  // useEditorStore is both a React hook (called with selector) and has getState
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const useEditorStore: any = vi.fn();
  useEditorStore.getState = mockGetState;
  return {
    useEditorStore,
    getCommandDispatcher: () => mockDispatcher,
  };
});

function mockProfile(overrides: Record<string, unknown> = {}) {
  return {
    colorblindMode: { enabled: false, mode: 'protanopia' as const, filterStrength: 1.0 },
    screenReader: { enabled: false, entityDescriptions: new Map(), navigationAnnouncements: true },
    inputRemapping: { enabled: false, remappings: [], onScreenControls: false },
    subtitles: { enabled: false, fontSize: 'medium' as const, backgroundColor: '#000', textColor: '#fff', opacity: 1.0 },
    fontSize: { enabled: false, scale: 1.0, minSize: 12 },
    ...overrides,
  };
}

vi.mock('@/lib/ai/accessibilityGenerator', () => ({
  analyzeAccessibility: vi.fn(() => ({
    score: 72,
    issues: [
      {
        category: 'visual',
        severity: 'major',
        message: 'No colorblind mode configured',
        suggestion: 'Enable colorblind simulation',
        wcagCriteria: '1.4.1',
        entities: [],
      },
    ],
    passedChecks: ['Screen reader descriptions present', 'Input remapping available'],
    totalChecks: 8,
    recommendations: [],
  })),
  generateAccessibilityProfile: vi.fn((_ctx) => mockProfile()),
  generateEntityDescriptions: vi.fn(() => new Map([['ent-1', 'A player entity']])),
  buildEntitySummaries: vi.fn(() => []),
  createDefaultProfile: vi.fn(() => mockProfile()),
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});

import { useEditorStore } from '@/stores/editorStore';
import { analyzeAccessibility } from '@/lib/ai/accessibilityGenerator';

const mockedStore = vi.mocked(useEditorStore);

function mockStore(overrides: Record<string, unknown> = {}) {
  const sceneGraph = (overrides.sceneGraph as Record<string, unknown>) ?? { nodes: {} };
  const state = {
    sceneGraph,
    ...overrides,
  } as unknown as Parameters<typeof useEditorStore>[0] extends (s: infer S) => unknown ? S : never;
  mockedStore.mockImplementation((selector) =>
    (selector as (s: typeof state) => unknown)(state),
  );
  // Also update getState so buildSceneContextFromStore works
  mockedStore.getState.mockReturnValue({
    sceneGraph,
    primaryMaterial: null,
    primaryLight: null,
    selectedIds: new Set<string>(),
    allScripts: {},
    inputBindings: [],
    allGameComponents: {},
    setAccessibilityProfile: mockSetAccessibilityProfile,
    ...overrides,
  } as unknown as ReturnType<typeof mockedStore.getState>);
}

describe('AccessibilityPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore();
  });

  afterEach(() => cleanup());

  it('renders the Accessibility heading', () => {
    render(<AccessibilityPanel />);
    expect(screen.getByText('Accessibility')).toBeInTheDocument();
  });

  it('shows entity count in the header', () => {
    mockStore({
      sceneGraph: {
        nodes: {
          'ent-1': { entityId: 'ent-1', components: [], name: 'Box' },
          'ent-2': { entityId: 'ent-2', components: [], name: 'Light' },
        },
      },
    });
    render(<AccessibilityPanel />);
    expect(screen.getByText('2 entities')).toBeInTheDocument();
  });

  it('shows 0 entities when scene graph is empty', () => {
    render(<AccessibilityPanel />);
    expect(screen.getByText('0 entities')).toBeInTheDocument();
  });

  it('renders Audit and Auto-Generate action buttons', () => {
    render(<AccessibilityPanel />);
    expect(screen.getByLabelText('Run accessibility audit')).toBeInTheDocument();
    expect(screen.getByLabelText('Auto-generate accessibility profile')).toBeInTheDocument();
  });

  it('calls analyzeAccessibility when Audit button is clicked', () => {
    render(<AccessibilityPanel />);
    fireEvent.click(screen.getByLabelText('Run accessibility audit'));
    expect(vi.mocked(analyzeAccessibility)).toHaveBeenCalledOnce();
  });

  it('displays audit score after running audit', () => {
    render(<AccessibilityPanel />);
    fireEvent.click(screen.getByLabelText('Run accessibility audit'));
    expect(screen.getByText('72')).toBeInTheDocument();
    expect(screen.getByText('Accessibility Score')).toBeInTheDocument();
  });

  it('displays issue count by category after audit', () => {
    render(<AccessibilityPanel />);
    fireEvent.click(screen.getByLabelText('Run accessibility audit'));
    expect(screen.getByText('1 issue')).toBeInTheDocument();
  });

  it('shows passed checks count after audit', () => {
    render(<AccessibilityPanel />);
    fireEvent.click(screen.getByLabelText('Run accessibility audit'));
    expect(screen.getByText('2/8 checks passed')).toBeInTheDocument();
  });

  it('shows issue message when visual category is expanded', () => {
    render(<AccessibilityPanel />);
    fireEvent.click(screen.getByLabelText('Run accessibility audit'));
    // Visual category should be expanded by default
    expect(screen.getByText('No colorblind mode configured')).toBeInTheDocument();
  });

  it('renders colorblind simulation section', () => {
    render(<AccessibilityPanel />);
    expect(screen.getByText('Colorblind Simulation')).toBeInTheDocument();
    expect(screen.getByLabelText('Simulate Protanopia')).toBeInTheDocument();
    expect(screen.getByLabelText('Simulate Deuteranopia')).toBeInTheDocument();
    expect(screen.getByLabelText('Simulate Tritanopia')).toBeInTheDocument();
    expect(screen.getByLabelText('Simulate Achromatopsia')).toBeInTheDocument();
  });

  it('enables colorblind simulation when a mode button is clicked', () => {
    render(<AccessibilityPanel />);
    // Clicking a mode button enables it and sets the mode
    fireEvent.click(screen.getByLabelText('Simulate Protanopia'));
    // After click, toggle button should show "Active" or "Off"
    // The filter strength slider should now appear
    expect(screen.getByLabelText('Colorblind filter strength')).toBeInTheDocument();
  });

  it('renders screen reader section with entity description count', () => {
    render(<AccessibilityPanel />);
    expect(screen.getByText('Screen Reader Descriptions')).toBeInTheDocument();
    expect(screen.getByText('0 entity descriptions generated')).toBeInTheDocument();
  });

  it('renders input remapping section', () => {
    render(<AccessibilityPanel />);
    expect(screen.getByText('Input Remapping')).toBeInTheDocument();
    expect(screen.getByText('No input bindings configured in the scene.')).toBeInTheDocument();
  });

  it('renders subtitles section', () => {
    render(<AccessibilityPanel />);
    expect(screen.getByText('Subtitles')).toBeInTheDocument();
  });

  it('renders font scale section', () => {
    render(<AccessibilityPanel />);
    expect(screen.getByText('Font Scale')).toBeInTheDocument();
  });

  it('syncs profile to store on mount (#8207)', () => {
    render(<AccessibilityPanel />);
    // useEffect fires on mount, syncing the default profile to the store
    expect(mockSetAccessibilityProfile).toHaveBeenCalled();
    const savedProfile = mockSetAccessibilityProfile.mock.calls[0][0];
    expect(savedProfile).toHaveProperty('colorblindMode');
    expect(savedProfile).toHaveProperty('screenReader');
    expect(savedProfile).toHaveProperty('inputRemapping');
  });

  it('applies colorblind CSS filter to game canvas when mode is enabled (#8207)', () => {
    // Create a mock canvas element
    const canvas = document.createElement('div');
    canvas.id = 'game-canvas';
    document.body.appendChild(canvas);

    render(<AccessibilityPanel />);
    // Enable colorblind mode by clicking a mode button
    fireEvent.click(screen.getByLabelText('Simulate Protanopia'));

    // The canvas should now have a CSS filter applied
    expect(canvas.style.filter).not.toBe('');

    document.body.removeChild(canvas);
  });

  it('removes colorblind CSS filter when mode is disabled (#8207)', () => {
    const canvas = document.createElement('div');
    canvas.id = 'game-canvas';
    document.body.appendChild(canvas);

    render(<AccessibilityPanel />);
    // Enable via mode button
    fireEvent.click(screen.getByLabelText('Simulate Protanopia'));
    expect(canvas.style.filter).not.toBe('');
    // Disable via the Active/Off toggle button
    fireEvent.click(screen.getByLabelText('Disable colorblind simulation'));
    expect(canvas.style.filter).toBe('');

    document.body.removeChild(canvas);
  });

  it('updates store when profile changes (#8207)', () => {
    render(<AccessibilityPanel />);
    mockSetAccessibilityProfile.mockClear();

    // Toggle screen reader
    const srToggle = screen.getByLabelText(/able screen reader/i);
    fireEvent.click(srToggle);

    // Store should be updated with screenReader.enabled = true
    expect(mockSetAccessibilityProfile).toHaveBeenCalled();
    const latestCall = mockSetAccessibilityProfile.mock.calls[mockSetAccessibilityProfile.mock.calls.length - 1][0];
    expect(latestCall.screenReader.enabled).toBe(true);
  });

  it('cleans up previously-applied keybindings when profile is regenerated (#8307)', async () => {
    // Set up mock to return profile A with remappings, then profile B with different remappings
    const { generateAccessibilityProfile } = await import('@/lib/ai/accessibilityGenerator');
    const mockGenerate = vi.mocked(generateAccessibilityProfile);

    // Profile A: Jump→Space input remapping
    mockGenerate.mockReturnValueOnce(mockProfile({
      inputRemapping: {
        enabled: true,
        remappings: [{ action: 'Jump', primaryKey: 'Space', alternativeKeys: [], gamepadButton: undefined }],
        onScreenControls: false,
      },
    }));

    // Profile B: Dash→Shift input remapping (Jump no longer present)
    mockGenerate.mockReturnValueOnce(mockProfile({
      inputRemapping: {
        enabled: true,
        remappings: [{ action: 'Dash', primaryKey: 'Shift', alternativeKeys: [], gamepadButton: undefined }],
        onScreenControls: false,
      },
    }));

    render(<AccessibilityPanel />);
    mockDispatcher.mockClear();

    // Generate profile A
    fireEvent.click(screen.getByLabelText('Auto-generate accessibility profile'));
    // Allow setTimeout(fn, 0) to fire
    await vi.waitFor(() => {
      expect(mockGenerate).toHaveBeenCalledTimes(1);
    });

    // Profile A should have dispatched set_input_binding for Jump
    const setJumpCalls = mockDispatcher.mock.calls.filter(
      ([cmd]) => cmd === 'set_input_binding',
    );
    expect(setJumpCalls.length).toBeGreaterThanOrEqual(1);
    expect(setJumpCalls.some(([_cmd, args]) => args.actionName === 'Jump')).toBe(true);

    mockDispatcher.mockClear();

    // Generate profile B (different remappings)
    fireEvent.click(screen.getByLabelText('Auto-generate accessibility profile'));
    await vi.waitFor(() => {
      expect(mockGenerate).toHaveBeenCalledTimes(2);
    });

    // The old Jump binding should have been removed
    const removeJumpCalls = mockDispatcher.mock.calls.filter(
      ([cmd, args]) => cmd === 'remove_input_binding' && args.actionName === 'Jump',
    );
    expect(removeJumpCalls.length).toBeGreaterThanOrEqual(1);

    // And the new Dash binding should have been applied
    const setDashCalls = mockDispatcher.mock.calls.filter(
      ([cmd, args]) => cmd === 'set_input_binding' && args.actionName === 'Dash',
    );
    expect(setDashCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('cleans up all applied keybindings on unmount (#8307)', async () => {
    const { generateAccessibilityProfile } = await import('@/lib/ai/accessibilityGenerator');
    const mockGenerate = vi.mocked(generateAccessibilityProfile);

    // Return a profile with enabled remappings when auto-generate is clicked
    mockGenerate.mockReturnValueOnce(mockProfile({
      inputRemapping: {
        enabled: true,
        remappings: [
          { action: 'Jump', primaryKey: 'Space', alternativeKeys: [], gamepadButton: undefined },
          { action: 'Fire', primaryKey: 'Enter', alternativeKeys: [], gamepadButton: undefined },
        ],
        onScreenControls: false,
      },
    }));

    const { unmount } = render(<AccessibilityPanel />);

    // Auto-generate to apply remappings
    fireEvent.click(screen.getByLabelText('Auto-generate accessibility profile'));
    await vi.waitFor(() => {
      expect(mockGenerate).toHaveBeenCalledTimes(1);
    });

    // Wait for React to process the state update and the useEffect to dispatch
    // set_input_binding. The flow is: click → setTimeout(0) → setProfile →
    // re-render → useEffect fires → dispatch. Without a second waitFor the
    // assertion races the effect and fails under full-suite load.
    await vi.waitFor(() => {
      const applyCalls = mockDispatcher.mock.calls.filter(
        ([cmd]) => cmd === 'set_input_binding',
      );
      expect(applyCalls.length).toBeGreaterThanOrEqual(2);
    });

    mockDispatcher.mockClear();

    unmount();

    // On unmount, all previously-applied bindings should be removed
    const removeCalls = mockDispatcher.mock.calls.filter(
      ([cmd]) => cmd === 'remove_input_binding',
    );
    const removedActions = removeCalls.map(([_cmd, args]) => args.actionName);
    expect(removedActions).toContain('Jump');
    expect(removedActions).toContain('Fire');
  });
});
