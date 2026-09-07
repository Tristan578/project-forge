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
    expect(screen.getByText('Select an entity to edit its script').textContent).toBe('Select an entity to edit its script');
  });

  it('shows forge API hints in empty state', () => {
    setupStore({ primaryId: null });
    render(<ScriptEditorPanel />);
    expect(screen.getByText('forge.transform').textContent).toBe('forge.transform');
    expect(screen.getByText('forge.input').textContent).toBe('forge.input');
    expect(screen.getByText('forge.physics').textContent).toBe('forge.physics');
  });

  // ── Entity selected, no script ────────────────────────────────────────

  it('shows No script attached message', () => {
    setupStore();
    render(<ScriptEditorPanel />);
    expect(screen.getByText('No scripts').textContent).toBe('No scripts');
  });

  it('shows Add Script button', () => {
    setupStore();
    render(<ScriptEditorPanel />);
    expect(screen.getByText('Add Script').textContent).toBe('Add Script');
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
    expect(screen.getByText('Movement').textContent).toBe('Movement');
    expect(screen.getByText('Shooter').textContent).toBe('Shooter');
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
    expect(screen.getByText('Player').textContent).toBe('Player');
  });

  it('renders Code and Graph view mode tabs', () => {
    setupStore({
      allScripts: { 'ent-1': { source: 'function onStart() {}', enabled: true } },
    });
    render(<ScriptEditorPanel />);
    expect(screen.getByText('Code').textContent).toBe('Code');
    expect(screen.getByText('Graph').textContent).toBe('Graph');
  });

  it('renders console section', () => {
    setupStore({
      allScripts: { 'ent-1': { source: 'function onStart() {}', enabled: true } },
    });
    render(<ScriptEditorPanel />);
    expect(screen.getByText('Console').textContent).toBe('Console');
    expect(screen.getByText('No output yet').textContent).toBe('No output yet');
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
    expect(screen.getByText('Script started!').textContent).toBe('Script started!');
    expect(screen.getByText('Null reference').textContent).toBe('Null reference');
  });

  /**
   * THE WILDCARD CHANNEL, which had no producer until #9284.
   *
   * The console filters to `l.entityId === primaryId || l.entityId === '*'`,
   * and nothing had ever emitted `'*'` — so the three runner messages that are
   * not attributable to one entity (an engine refusal, the infinite-loop
   * watchdog, and a command blocked by the allowlist) were written to a channel
   * with no reader. Each of those is exactly the message an author needs when
   * their script silently does nothing.
   *
   * This asserts the CONSUMER half. `useScriptRunner.test.ts` asserts the three
   * producers use `'*'`; on its own that would pin my belief about this filter
   * rather than the filter itself (lessons-learned #14), so the rendering is
   * checked here against the real component.
   */
  it('shows a wildcard log whatever entity is selected', () => {
    setupStore({
      primaryId: 'ent-1',
      allScripts: { 'ent-1': { source: 'code', enabled: true } },
      scriptLogs: [
        { entityId: '*', level: 'error', message: 'Blocked command "set_velocity2d"' },
        { entityId: 'someone-else', level: 'info', message: 'Not for this entity' },
      ],
    });
    render(<ScriptEditorPanel />);
    expect(screen.getByText('Blocked command "set_velocity2d"')).toBeTruthy();
    // The filter still filters: a log owned by another entity stays hidden.
    expect(screen.queryByText('Not for this entity')).toBeNull();
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
    expect(screen.getByText(/Show Console/)).toBeInTheDocument();
  });

  it('shows console again on Show Console click', () => {
    setupStore({
      allScripts: { 'ent-1': { source: 'code', enabled: true } },
    });
    render(<ScriptEditorPanel />);
    fireEvent.click(screen.getByText('Hide'));
    fireEvent.click(screen.getByText(/Show Console/));
    expect(screen.getByText('Console').textContent).toBe('Console');
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
    expect(checkbox).not.toBeNull();
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
    expect(templateSelect).not.toBeNull();
  });
});
