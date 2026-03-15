/**
 * Tests for ScriptExplorerPanel — tabs, entity scripts, library scripts,
 * search/filter, toggle, delete, new script, templates, attach, import/export.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ScriptExplorerPanel } from '../ScriptExplorerPanel';
import { useEditorStore } from '@/stores/editorStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { loadScripts, saveScript } from '@/stores/scriptLibraryStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: vi.fn(() => ({})),
}));

vi.mock('@/stores/scriptLibraryStore', () => ({
  loadScripts: vi.fn(() => []),
  saveScript: vi.fn(),
  deleteScript: vi.fn(),
  duplicateScript: vi.fn(),
  exportScript: vi.fn(() => '{"name":"test"}'),
  importScript: vi.fn(),
}));

vi.mock('@/lib/scripting/scriptTemplates', () => ({
  SCRIPT_TEMPLATES: [
    { id: 'movement', name: 'Movement', description: 'Basic movement', source: 'function onUpdate(dt) {}' },
    { id: 'shooter', name: 'Shooter', description: 'Shoot projectiles', source: 'function onUpdate(dt) {}' },
  ],
}));

const mockSelectEntity = vi.fn();
const mockSetScript = vi.fn();
const mockRemoveScript = vi.fn();
const mockOpenScriptEditor = vi.fn();

function setupStore(overrides: {
  primaryId?: string | null;
  allScripts?: Record<string, { source: string; enabled: boolean } | undefined>;
  sceneGraph?: { nodes: Record<string, { name: string }> };
} = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => {
    const state = {
      primaryId: overrides.primaryId ?? 'ent-1',
      allScripts: overrides.allScripts ?? {
        'ent-1': { source: 'function onStart() {}', enabled: true },
        'ent-2': { source: 'function onUpdate(dt) {}', enabled: false },
      },
      sceneGraph: overrides.sceneGraph ?? {
        nodes: {
          'ent-1': { name: 'Player' },
          'ent-2': { name: 'Enemy' },
        },
      },
      selectEntity: mockSelectEntity,
      setScript: mockSetScript,
      removeScript: mockRemoveScript,
    };
    return selector(state);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useWorkspaceStore).mockImplementation((selector: any) => {
    const state = { openScriptEditor: mockOpenScriptEditor };
    return selector(state);
  });
}

describe('ScriptExplorerPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Header ────────────────────────────────────────────────────────────

  it('renders Scripts header', () => {
    setupStore();
    render(<ScriptExplorerPanel />);
    expect(screen.getByText('Scripts')).toBeDefined();
  });

  // ── Tabs ──────────────────────────────────────────────────────────────

  it('renders Entity and Library tabs', () => {
    setupStore();
    render(<ScriptExplorerPanel />);
    expect(screen.getByText(/Entity/)).toBeDefined();
    expect(screen.getByText(/Library/)).toBeDefined();
  });

  it('shows entity count in tab', () => {
    setupStore();
    render(<ScriptExplorerPanel />);
    expect(screen.getByText(/Entity \(2\)/)).toBeDefined();
  });

  // ── Entity tab ────────────────────────────────────────────────────────

  it('renders entity script entries', () => {
    setupStore();
    render(<ScriptExplorerPanel />);
    expect(screen.getByText('Player')).toBeDefined();
    expect(screen.getByText('Enemy')).toBeDefined();
  });

  it('shows disabled label for disabled scripts', () => {
    setupStore();
    render(<ScriptExplorerPanel />);
    expect(screen.getByText(/\(disabled\)/)).toBeDefined();
  });

  it('shows char count for scripts', () => {
    setupStore();
    render(<ScriptExplorerPanel />);
    expect(screen.getByText(/21 chars/)).toBeDefined(); // 'function onStart() {}'.length = 21
  });

  it('selects entity and opens editor on click', () => {
    setupStore();
    render(<ScriptExplorerPanel />);
    fireEvent.click(screen.getByText('Player'));
    expect(mockSelectEntity).toHaveBeenCalledWith('ent-1', 'replace');
    expect(mockOpenScriptEditor).toHaveBeenCalledWith('ent-1', 'Player');
  });

  it('removes script on delete click', () => {
    setupStore();
    render(<ScriptExplorerPanel />);
    const deleteButtons = document.querySelectorAll('[title="Remove script"]');
    fireEvent.click(deleteButtons[0]);
    expect(mockRemoveScript).toHaveBeenCalled();
  });

  // ── Search ────────────────────────────────────────────────────────────

  it('renders search input', () => {
    setupStore();
    render(<ScriptExplorerPanel />);
    expect(screen.getByPlaceholderText('Filter scripts...')).toBeDefined();
  });

  it('filters entity scripts by name', () => {
    setupStore();
    render(<ScriptExplorerPanel />);
    fireEvent.change(screen.getByPlaceholderText('Filter scripts...'), {
      target: { value: 'Play' },
    });
    expect(screen.getByText('Player')).toBeDefined();
    expect(screen.queryByText('Enemy')).toBeNull();
  });

  it('shows no matches message when filter has no results', () => {
    setupStore();
    render(<ScriptExplorerPanel />);
    fireEvent.change(screen.getByPlaceholderText('Filter scripts...'), {
      target: { value: 'zzzzz' },
    });
    expect(screen.getByText('No matches')).toBeDefined();
  });

  // ── Empty entity state ────────────────────────────────────────────────

  it('shows empty state when no entity scripts', () => {
    setupStore({ allScripts: {} });
    render(<ScriptExplorerPanel />);
    expect(screen.getByText('No entity scripts')).toBeDefined();
  });

  // ── Library tab ───────────────────────────────────────────────────────

  it('switches to Library tab', () => {
    setupStore();
    vi.mocked(loadScripts).mockReturnValue([
      { id: 'lib-1', name: 'Helper', description: 'A helper script', source: 'code', tags: ['util'], createdAt: '2024-01-01', updatedAt: '2024-01-01' },
    ]);
    render(<ScriptExplorerPanel />);
    fireEvent.click(screen.getByText(/Library/));
    expect(screen.getByText('Helper')).toBeDefined();
  });

  it('shows empty library state', () => {
    setupStore();
    vi.mocked(loadScripts).mockReturnValue([]);
    render(<ScriptExplorerPanel />);
    fireEvent.click(screen.getByText(/Library/));
    expect(screen.getByText('No library scripts')).toBeDefined();
  });

  // ── New script menu ───────────────────────────────────────────────────

  it('opens new script menu', () => {
    setupStore();
    render(<ScriptExplorerPanel />);
    fireEvent.click(screen.getByTitle('New script'));
    expect(screen.getByText('Blank Script')).toBeDefined();
    expect(screen.getByText('From Template')).toBeDefined();
  });

  it('creates blank script from menu', () => {
    setupStore();
    render(<ScriptExplorerPanel />);
    fireEvent.click(screen.getByTitle('New script'));
    fireEvent.click(screen.getByText('Blank Script'));
    expect(saveScript).toHaveBeenCalled();
  });

  it('creates script from template', () => {
    setupStore();
    render(<ScriptExplorerPanel />);
    fireEvent.click(screen.getByTitle('New script'));
    fireEvent.click(screen.getByText('Movement'));
    expect(saveScript).toHaveBeenCalled();
  });
});
