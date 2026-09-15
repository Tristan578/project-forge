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
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { SceneHierarchy } from '../SceneHierarchy';

expect.extend(toHaveNoViolations);

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
    expect(results).toHaveNoViolations();
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
});
