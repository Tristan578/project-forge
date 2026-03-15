/**
 * Tests for ScriptEditorPanel — no entity, no script, has script states,
 * add/remove script, template selection, enable toggle, save, console, view modes.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ScriptEditorPanel } from '../ScriptEditorPanel';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => {
    const Placeholder = () => <div data-testid="monaco-editor">Monaco Editor</div>;
    Placeholder.displayName = 'MonacoEditor';
    return Placeholder;
  },
}));

vi.mock('@/lib/scripting/scriptTemplates', () => ({
  SCRIPT_TEMPLATES: [
    { id: 'movement', name: 'Movement', description: 'Basic movement', source: 'function onUpdate(dt) { /* movement */ }' },
    { id: 'shooter', name: 'Shooter', description: 'Shoot projectiles', source: 'function onUpdate(dt) { /* shooter */ }' },
  ],
}));

vi.mock('@/lib/scripting/forgeTypes', () => ({
  FORGE_TYPE_DEFINITIONS: 'declare const forge: any;',
}));

vi.mock('@/lib/scripting/graphCompiler', () => ({
  compileGraph: vi.fn(() => ({ success: true, code: '', errors: [] })),
}));

const mockSetScript = vi.fn();
const mockRemoveScript = vi.fn();
const mockApplyScriptTemplate = vi.fn();
const mockClearScriptLogs = vi.fn();

function setupStore(overrides: {
  primaryId?: string | null;
  primaryName?: string | null;
  primaryScript?: { source: string; enabled: boolean } | null;
  allScripts?: Record<string, { source: string; enabled: boolean } | undefined>;
  scriptLogs?: Array<{ entityId: string; level: string; message: string }>;
} = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => {
    const state = {
      primaryId: 'primaryId' in overrides ? overrides.primaryId : 'ent-1',
      primaryName: overrides.primaryName ?? 'Player',
      primaryScript: 'primaryScript' in overrides ? overrides.primaryScript : null,
      allScripts: overrides.allScripts ?? {},
      scriptLogs: overrides.scriptLogs ?? [],
      setScript: mockSetScript,
      removeScript: mockRemoveScript,
      applyScriptTemplate: mockApplyScriptTemplate,
      clearScriptLogs: mockClearScriptLogs,
    };
    return selector(state);
  });
}

describe('ScriptEditorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── No entity selected ────────────────────────────────────────────────

  it('shows empty state when no entity selected', () => {
    setupStore({ primaryId: null });
    render(<ScriptEditorPanel />);
    expect(screen.getByText('Select an entity to edit its script')).toBeDefined();
  });

  it('shows forge API hints in empty state', () => {
    setupStore({ primaryId: null });
    render(<ScriptEditorPanel />);
    expect(screen.getByText('forge.transform')).toBeDefined();
    expect(screen.getByText('forge.input')).toBeDefined();
    expect(screen.getByText('forge.physics')).toBeDefined();
  });

  // ── Entity selected, no script ────────────────────────────────────────

  it('shows No script attached message', () => {
    setupStore();
    render(<ScriptEditorPanel />);
    expect(screen.getByText('No script attached')).toBeDefined();
  });

  it('shows Add Script button', () => {
    setupStore();
    render(<ScriptEditorPanel />);
    expect(screen.getByText('Add Script')).toBeDefined();
  });

  it('adds default script on Add Script click', () => {
    setupStore();
    render(<ScriptEditorPanel />);
    fireEvent.click(screen.getByText('Add Script'));
    expect(mockSetScript).toHaveBeenCalledWith('ent-1', expect.stringContaining('function onStart'), true);
  });

  it('shows script templates in no-script state', () => {
    setupStore();
    render(<ScriptEditorPanel />);
    expect(screen.getByText('Movement')).toBeDefined();
    expect(screen.getByText('Shooter')).toBeDefined();
  });

  it('applies template on template click', () => {
    setupStore();
    render(<ScriptEditorPanel />);
    fireEvent.click(screen.getByText('Movement'));
    expect(mockApplyScriptTemplate).toHaveBeenCalledWith(
      'ent-1',
      'movement',
      expect.stringContaining('movement'),
    );
  });

  // ── Entity has script ─────────────────────────────────────────────────

  it('renders editor header with entity name', () => {
    setupStore({
      allScripts: { 'ent-1': { source: 'function onStart() {}', enabled: true } },
    });
    render(<ScriptEditorPanel />);
    expect(screen.getByText('Player')).toBeDefined();
  });

  it('renders Code and Graph view mode tabs', () => {
    setupStore({
      allScripts: { 'ent-1': { source: 'function onStart() {}', enabled: true } },
    });
    render(<ScriptEditorPanel />);
    expect(screen.getByText('Code')).toBeDefined();
    expect(screen.getByText('Graph')).toBeDefined();
  });

  it('renders console section', () => {
    setupStore({
      allScripts: { 'ent-1': { source: 'function onStart() {}', enabled: true } },
    });
    render(<ScriptEditorPanel />);
    expect(screen.getByText('Console')).toBeDefined();
    expect(screen.getByText('No output yet')).toBeDefined();
  });

  it('shows script logs in console', () => {
    setupStore({
      allScripts: { 'ent-1': { source: 'code', enabled: true } },
      scriptLogs: [
        { entityId: 'ent-1', level: 'info', message: 'Script started!' },
        { entityId: 'ent-1', level: 'error', message: 'Null reference' },
      ],
    });
    render(<ScriptEditorPanel />);
    expect(screen.getByText('Script started!')).toBeDefined();
    expect(screen.getByText('Null reference')).toBeDefined();
  });

  it('clears logs on Clear click', () => {
    setupStore({
      allScripts: { 'ent-1': { source: 'code', enabled: true } },
      scriptLogs: [{ entityId: 'ent-1', level: 'info', message: 'log' }],
    });
    render(<ScriptEditorPanel />);
    fireEvent.click(screen.getByText('Clear'));
    expect(mockClearScriptLogs).toHaveBeenCalledOnce();
  });

  it('hides console on Hide click', () => {
    setupStore({
      allScripts: { 'ent-1': { source: 'code', enabled: true } },
    });
    render(<ScriptEditorPanel />);
    fireEvent.click(screen.getByText('Hide'));
    expect(screen.queryByText('Console')).toBeNull();
    expect(screen.getByText(/Show Console/)).toBeDefined();
  });

  it('shows console again on Show Console click', () => {
    setupStore({
      allScripts: { 'ent-1': { source: 'code', enabled: true } },
    });
    render(<ScriptEditorPanel />);
    fireEvent.click(screen.getByText('Hide'));
    fireEvent.click(screen.getByText(/Show Console/));
    expect(screen.getByText('Console')).toBeDefined();
  });

  it('removes script on Remove button click', () => {
    setupStore({
      allScripts: { 'ent-1': { source: 'code', enabled: true } },
    });
    render(<ScriptEditorPanel />);
    fireEvent.click(screen.getByTitle('Remove script'));
    expect(mockRemoveScript).toHaveBeenCalledWith('ent-1');
  });

  it('renders enable toggle checkbox', () => {
    setupStore({
      allScripts: { 'ent-1': { source: 'code', enabled: true } },
    });
    render(<ScriptEditorPanel />);
    const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).toBeDefined();
    expect(checkbox.checked).toBe(true);
  });

  it('renders template dropdown in editor header', () => {
    setupStore({
      allScripts: { 'ent-1': { source: 'code', enabled: true } },
    });
    render(<ScriptEditorPanel />);
    const selects = document.querySelectorAll('select');
    const templateSelect = Array.from(selects).find((s) =>
      Array.from(s.options).some((o) => o.textContent === 'Movement'),
    );
    expect(templateSelect).toBeDefined();
  });
});
