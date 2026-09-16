/**
 * Accessibility + keyboard-operability tests for the Scene Hierarchy tree.
 *
 * Covers operation localization.FR-2.OP-01 (keyboard/focus/name/state audit)
 * and OP-04 (custom hierarchy markup regression gate):
 *   - jest-axe assertion over the rendered tree (zero violations)
 *   - roving tabindex: exactly one row is in the tab order at a time
 *   - Tab / ArrowDown / Home / End move DOM focus and the roving index
 *   - Enter selects the focused row through the store dispatch
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@/test/utils/componentTestUtils';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { SceneHierarchy } from '../SceneHierarchy';

function summarize(violations: { id: string; impact?: string | null; help?: string }[]): string {
  return violations.map((v) => `[${v.impact ?? 'unknown'}] ${v.id}: ${v.help ?? ''}`).join('\n');
}

// Render lucide icons as null so the axe/keyboard assertions focus on the
// tree's own semantics (roles, names, tabindex), not the icon SVGs.
vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map((k) => [k, () => null]));
});

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
  getCommandDispatcher: vi.fn(() => vi.fn()),
}));

import { useEditorStore } from '@/stores/editorStore';

const mockSelectEntity = vi.fn();

function makeFixtureGraph() {
  return {
    rootIds: ['cam', 'player', 'ground'],
    nodes: {
      cam: { entityId: 'cam', name: 'Camera', visible: true, parentId: null, children: [], components: [] },
      player: { entityId: 'player', name: 'Player', visible: true, parentId: null, children: ['sword'], components: [] },
      sword: { entityId: 'sword', name: 'Sword', visible: true, parentId: 'player', children: [], components: [] },
      ground: { entityId: 'ground', name: 'Ground', visible: true, parentId: null, children: [], components: [] },
    },
  };
}

function mockStore(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    sceneGraph: makeFixtureGraph(),
    selectedIds: new Set<string>(),
    primaryId: null,
    clearSelection: vi.fn(),
    selectEntity: mockSelectEntity,
    selectRange: vi.fn(),
    toggleVisibility: vi.fn(),
    deleteSelectedEntities: vi.fn(),
    duplicateSelectedEntity: vi.fn(),
    renameEntity: vi.fn(),
    reparentEntity: vi.fn(),
    hierarchyFilter: '',
    setHierarchyFilter: vi.fn(),
    clearHierarchyFilter: vi.fn(),
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(state));
}

// jsdom does not implement scrollIntoView; the focus effect calls it.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
  mockStore();
});

afterEach(() => cleanup());

describe('SceneHierarchy accessibility (localization.FR-2.OP-01 / OP-04)', () => {
  it('has zero axe violations over the rendered tree', async () => {
    const { container } = render(<SceneHierarchy />);
    const results = await axe(container);
    expect(results.violations, summarize(results.violations)).toHaveLength(0);
  });

  it('exposes exactly one row in the tab order (roving tabindex)', () => {
    render(<SceneHierarchy />);
    const rows = screen.getAllByRole('treeitem');
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Camera',
      'Player',
      'Sword',
      'Ground',
    ]);
    // First visible row holds the roving tabindex; every other row is -1.
    expect(rows[0]).toHaveAttribute('tabindex', '0');
    for (const row of rows.slice(1)) {
      expect(row).toHaveAttribute('tabindex', '-1');
    }
  });

  it('ArrowDown moves DOM focus and the roving tabindex to the next row', async () => {
    const user = userEvent.setup();
    render(<SceneHierarchy />);
    const tree = screen.getByRole('tree');
    tree.focus();

    await user.keyboard('{ArrowDown}'); // -> Camera (index 0)
    let rows = screen.getAllByRole('treeitem');
    expect(rows[0]).toHaveFocus();
    expect(rows[0]).toHaveAttribute('tabindex', '0');

    await user.keyboard('{ArrowDown}'); // -> Player (index 1)
    rows = screen.getAllByRole('treeitem');
    expect(rows[1]).toHaveFocus();
    expect(rows[1]).toHaveAttribute('tabindex', '0');
    expect(rows[0]).toHaveAttribute('tabindex', '-1');
  });

  it('Home and End jump focus to the first and last visible rows', async () => {
    const user = userEvent.setup();
    render(<SceneHierarchy />);
    const tree = screen.getByRole('tree');
    tree.focus();

    await user.keyboard('{End}');
    let rows = screen.getAllByRole('treeitem');
    expect(rows[rows.length - 1]).toHaveFocus(); // Ground
    expect(rows[rows.length - 1]).toHaveAttribute('tabindex', '0');

    await user.keyboard('{Home}');
    rows = screen.getAllByRole('treeitem');
    expect(rows[0]).toHaveFocus(); // Camera
    expect(rows[0]).toHaveAttribute('tabindex', '0');
  });

  it('Enter selects the focused row through the store dispatch', async () => {
    const user = userEvent.setup();
    render(<SceneHierarchy />);
    const tree = screen.getByRole('tree');
    tree.focus();

    await user.keyboard('{ArrowDown}{ArrowDown}'); // focus Player
    await user.keyboard('{Enter}');

    expect(mockSelectEntity).toHaveBeenCalledWith('player', 'replace');
  });

  it('keeps every row chevron and visibility control out of the tab order', () => {
    // Single-tab-stop tree (ARIA composite widget): the per-row chevron and eye
    // buttons must never be independent page Tab stops — not on the active row
    // and not on any other row. Only the roving treeitem carries tabindex=0.
    render(<SceneHierarchy />);

    // Camera is the active (roving) row; its inner controls are still -1.
    expect(screen.getByRole('button', { name: 'Hide Camera' })).toHaveAttribute('tabindex', '-1');
    // Player is a non-active row with children, so its chevron renders.
    expect(screen.getByRole('button', { name: 'Collapse Player' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('button', { name: 'Hide Player' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('button', { name: 'Hide Ground' })).toHaveAttribute('tabindex', '-1');
  });

  it('Tab from the roving row skips all inner controls and exits the tree', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <SceneHierarchy />
        <button data-testid="after">after</button>
      </div>,
    );

    const rows = screen.getAllByRole('treeitem');
    rows[0].focus(); // the roving row (Camera)
    expect(rows[0]).toHaveFocus();

    // A single Tab must land on the element AFTER the tree, proving none of the
    // chevron/eye buttons on any row are in the page Tab order.
    await user.tab();
    expect(screen.getByTestId('after')).toHaveFocus();
  });

  it('V toggles visibility of the focused row (keyboard path for the eye toggle)', async () => {
    const toggleVisibility = vi.fn();
    mockStore({ toggleVisibility });
    const user = userEvent.setup();
    render(<SceneHierarchy />);
    const tree = screen.getByRole('tree');
    tree.focus();

    await user.keyboard('{ArrowDown}{ArrowDown}'); // focus Player
    await user.keyboard('v');

    expect(toggleVisibility).toHaveBeenCalledWith('player');
  });

  it('ArrowDown/ArrowUp/Home/End do not commit an in-progress rename (#9875)', async () => {
    const renameEntity = vi.fn();
    mockStore({ renameEntity });
    const user = userEvent.setup();
    render(<SceneHierarchy />);
    const tree = screen.getByRole('tree');
    tree.focus();

    await user.keyboard('{ArrowDown}'); // focus Camera
    await user.keyboard('{F2}'); // enter rename mode on Camera

    const input = await within(tree).findByRole('textbox');
    await waitFor(() => expect(input).toHaveFocus());

    // Replace the full name with partial text, then navigate with each of the
    // roving-tabindex keys the container also handles. None of them may blur
    // the input (which would commit "Ca" as the new entity name).
    await user.clear(input);
    await user.type(input, 'Ca');
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(input).toHaveFocus();
    await user.keyboard('{End}');
    expect(input).toHaveFocus();
    await user.keyboard('{Home}');
    expect(input).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(input).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(input).toHaveFocus();

    expect(renameEntity).not.toHaveBeenCalled();

    // The guard only blocks navigation; committing via Enter still works.
    await user.keyboard('{Enter}');
    expect(renameEntity).toHaveBeenCalledWith('cam', 'Ca');
  });

  it('renders a childless, axe-valid tree when the scene is empty', async () => {
    // The empty-scene UI must live OUTSIDE role="tree": a tree that CONTAINS a
    // non-treeitem child trips aria-required-children (critical). An empty tree
    // with no children is only "incomplete" (axe reviewEmpty), not a violation.
    mockStore({ sceneGraph: { rootIds: [], nodes: {} } });
    const { container } = render(<SceneHierarchy />);

    const tree = screen.getByRole('tree');
    const emptyState = screen.getByText(/No entities yet/i);
    // The empty state is a sibling of the tree, never its child.
    expect(tree.contains(emptyState)).toBe(false);
    expect(tree.querySelector('[role="treeitem"], [role="group"]')).toBeNull();

    const results = await axe(container);
    expect(results.violations, summarize(results.violations)).toHaveLength(0);
    expect(results.violations.map((v) => v.id)).not.toContain('aria-required-children');
  });
});
