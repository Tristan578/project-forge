import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { ScriptEditorPanel } from '../ScriptEditorPanel';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
}));

vi.mock('lucide-react', () => new Proxy({}, {
  get: (_, name) => {
    if (name === '__esModule') return true;
    return vi.fn(() => null);
  },
}));

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('@/lib/scripting/scriptTemplates', () => ({
  SCRIPT_TEMPLATES: [
    { id: 'movement', name: 'Movement', description: 'Basic movement script', source: '// movement' },
    { id: 'rotate', name: 'Rotate', description: 'Rotation script', source: '// rotate' },
  ],
}));

vi.mock('@/lib/scripting/forgeTypes', () => ({
  FORGE_TYPE_DEFINITIONS: '',
}));

vi.mock('@/lib/scripting/graphCompiler', () => ({
  compileGraph: vi.fn(() => ({ success: true, code: '', errors: [] })),
}));

import { useEditorStore } from '@/stores/editorStore';

function mockEditorStore(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    primaryId: null,
    primaryName: null,
    primaryScript: null,
    allScripts: {},
    scriptLogs: [],
    setScript: vi.fn(),
    removeScript: vi.fn(),
    applyScriptTemplate: vi.fn(),
    clearScriptLogs: vi.fn(),
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(state));
}

describe('ScriptEditorPanel', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('shows empty state when no entity is selected', () => {
    mockEditorStore();
    render(<ScriptEditorPanel />);
    expect(screen.getByText('Select an entity to edit its script')).toBeDefined();
  });

  it('shows add script UI when entity has no script', () => {
    mockEditorStore({
      primaryId: 'ent-1',
      primaryName: 'MyCube',
    });
    render(<ScriptEditorPanel />);
    expect(screen.getByText('No script attached')).toBeDefined();
    expect(screen.getByText('Add Script')).toBeDefined();
    // Templates listed
    expect(screen.getByText('Movement')).toBeDefined();
    expect(screen.getByText('Rotate')).toBeDefined();
  });

  it('shows script editor header when entity has a script', () => {
    mockEditorStore({
      primaryId: 'ent-1',
      primaryName: 'MyCube',
      allScripts: {
        'ent-1': { source: 'function onStart() {}', enabled: true },
      },
    });
    render(<ScriptEditorPanel />);
    expect(screen.getByText('MyCube')).toBeDefined();
    expect(screen.getByText('Code')).toBeDefined();
    expect(screen.getByText('Graph')).toBeDefined();
  });
});
