/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { AccessibilityPanel } from '../AccessibilityPanel';

vi.mock('@/stores/editorStore', () => {
  const mockGetState = vi.fn(() => ({
    sceneGraph: { nodes: {} },
    primaryMaterial: null,
    primaryLight: null,
    selectedIds: new Set<string>(),
    allScripts: {},
    inputBindings: [],
    allGameComponents: {},
  }));
  // useEditorStore is both a React hook (called with selector) and has getState
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const useEditorStore: any = vi.fn();
  useEditorStore.getState = mockGetState;
  return { useEditorStore };
});

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
  generateAccessibilityProfile: vi.fn((ctx) => ({
    colorblindMode: { enabled: false, mode: 'protanopia', filterStrength: 1.0 },
    screenReader: { enabled: false, entityDescriptions: new Map(), announcements: [] },
    inputRemapping: { enabled: false, remappings: [] },
    subtitles: { enabled: false, fontSize: 'medium', position: 'bottom', backgroundColor: '#000', textColor: '#fff' },
    fontSize: { enabled: false, scale: 1.0 },
    reducedMotion: false,
    highContrast: false,
    ctx,
  })),
  generateEntityDescriptions: vi.fn(() => new Map([['ent-1', 'A player entity']])),
  buildEntitySummaries: vi.fn(() => []),
  createDefaultProfile: vi.fn(() => ({
    colorblindMode: { enabled: false, mode: 'protanopia', filterStrength: 1.0 },
    screenReader: { enabled: false, entityDescriptions: new Map(), announcements: [] },
    inputRemapping: { enabled: false, remappings: [] },
    subtitles: { enabled: false, fontSize: 'medium', position: 'bottom', backgroundColor: '#000', textColor: '#fff' },
    fontSize: { enabled: false, scale: 1.0 },
    reducedMotion: false,
    highContrast: false,
  })),
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
});
