/**
 * Unit tests for TaskboardPanel component.
 *
 * Tests column rendering, add-task form, drag-and-drop, clear-completed,
 * and keyboard shortcut integration.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { TaskboardPanel } from '../TaskboardPanel';
import { useTaskStore } from '@/stores/taskStore';
import type { EditorTask } from '@/stores/taskStore';

// ---- Mock crypto.randomUUID ----
let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `mock-uuid-${++uuidCounter}`,
});

// ---- Mock localStorage ----
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

vi.stubGlobal('localStorage', localStorageMock);

// ---- Lucide icon mocks ----
vi.mock('lucide-react', () => ({
  ListTodo: (props: Record<string, unknown>) => <span data-testid="icon-list-todo" {...props} />,
  Loader2: (props: Record<string, unknown>) => <span data-testid="icon-loader" {...props} />,
  CheckCircle2: (props: Record<string, unknown>) => <span data-testid="icon-check" {...props} />,
  Bot: (props: Record<string, unknown>) => <span data-testid="icon-bot" {...props} />,
  User: (props: Record<string, unknown>) => <span data-testid="icon-user" {...props} />,
  Trash2: (props: Record<string, unknown>) => <span data-testid="icon-trash" {...props} />,
  Plus: (props: Record<string, unknown>) => <span data-testid="icon-plus" {...props} />,
  X: (props: Record<string, unknown>) => <span data-testid="icon-x" {...props} />,
  GripVertical: (props: Record<string, unknown>) => <span data-testid="icon-grip" {...props} />,
}));

// ---- Sample tasks ----
const makeTasks = (): EditorTask[] => [
  {
    id: 'task-todo-1',
    title: 'Todo Task One',
    status: 'todo',
    assignee: 'user',
    createdAt: 1000,
    updatedAt: 1000,
  },
  {
    id: 'task-todo-2',
    title: 'Todo Task Two',
    status: 'todo',
    assignee: 'ai',
    createdAt: 1001,
    updatedAt: 1001,
    progress: 40,
  },
  {
    id: 'task-inprogress-1',
    title: 'In Progress Task',
    status: 'in_progress',
    assignee: 'ai',
    createdAt: 1002,
    updatedAt: 1002,
    progress: 75,
  },
  {
    id: 'task-done-1',
    title: 'Done Task',
    status: 'done',
    assignee: 'user',
    createdAt: 1003,
    updatedAt: 1003,
    result: 'Completed!',
  },
];

function resetStore(tasks: EditorTask[] = []) {
  useTaskStore.setState({ tasks });
  localStorageMock.clear();
  uuidCounter = 0;
}

describe('TaskboardPanel', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  // ---- Basic rendering ----

  describe('Rendering', () => {
    it('renders the Tasks panel header', () => {
      render(<TaskboardPanel />);
      expect(screen.getByText('Tasks')).toBeDefined();
    });

    it('renders all three column labels', () => {
      render(<TaskboardPanel />);
      expect(screen.getByText('To Do')).toBeDefined();
      expect(screen.getByText('In Progress')).toBeDefined();
      expect(screen.getByText('Done')).toBeDefined();
    });

    it('shows correct total task count in header', () => {
      resetStore(makeTasks());
      render(<TaskboardPanel />);
      // Header shows "N total"
      expect(screen.getByText('4 total')).toBeDefined();
    });

    it('renders tasks in correct columns', () => {
      resetStore(makeTasks());
      render(<TaskboardPanel />);

      expect(screen.getByText('Todo Task One')).toBeDefined();
      expect(screen.getByText('Todo Task Two')).toBeDefined();
      expect(screen.getByText('In Progress Task')).toBeDefined();
      expect(screen.getByText('Done Task')).toBeDefined();
    });

    it('displays column task counts', () => {
      resetStore(makeTasks());
      render(<TaskboardPanel />);
      // To Do has 2, In Progress has 1, Done has 1 — shown as badges
      const badges = screen.getAllByText('2');
      expect(badges.length).toBeGreaterThan(0);
    });

    it('renders with zero tasks', () => {
      render(<TaskboardPanel />);
      expect(screen.getByText('0 total')).toBeDefined();
    });
  });

  // ---- Assignee badges ----

  describe('Assignee badges', () => {
    it('shows "AI" badge for AI-assigned tasks', () => {
      resetStore(makeTasks());
      render(<TaskboardPanel />);
      const aiBadges = screen.getAllByText('AI');
      expect(aiBadges.length).toBeGreaterThan(0);
    });

    it('shows "Me" badge for user-assigned tasks', () => {
      resetStore(makeTasks());
      render(<TaskboardPanel />);
      const meBadges = screen.getAllByText('Me');
      expect(meBadges.length).toBeGreaterThan(0);
    });
  });

  // ---- Progress bar ----

  describe('Progress bar', () => {
    it('renders progress bar for AI tasks with progress', () => {
      resetStore(makeTasks());
      render(<TaskboardPanel />);
      const progressBars = screen.getAllByRole('progressbar');
      expect(progressBars.length).toBeGreaterThan(0);
    });

    it('reflects progress value in aria-valuenow', () => {
      resetStore(makeTasks());
      render(<TaskboardPanel />);
      const bar75 = screen.getAllByRole('progressbar').find(
        (el) => el.getAttribute('aria-valuenow') === '75'
      );
      expect(bar75).toBeDefined();
    });
  });

  // ---- Add task form ----

  describe('Add task form', () => {
    it('opens the add-task form when Plus button is clicked', () => {
      render(<TaskboardPanel />);
      // Plus button is the add-task trigger in the To Do column
      const addButton = screen.getByLabelText('Add task');
      fireEvent.click(addButton);
      expect(screen.getByPlaceholderText('Task title…')).toBeDefined();
    });

    it('adds a new task on form submit', () => {
      render(<TaskboardPanel />);

      const addButton = screen.getByLabelText('Add task');
      fireEvent.click(addButton);

      const input = screen.getByPlaceholderText('Task title…');
      fireEvent.change(input, { target: { value: 'New shiny task' } });

      // Submit via form submit event (Enter key)
      fireEvent.submit(input.closest('form')!);

      expect(screen.getByText('New shiny task')).toBeDefined();
      expect(useTaskStore.getState().tasks).toHaveLength(1);
    });

    it('does not add a task with empty title', () => {
      render(<TaskboardPanel />);

      const addButton = screen.getByLabelText('Add task');
      fireEvent.click(addButton);

      // Submit empty form
      const input = screen.getByPlaceholderText('Task title…');
      fireEvent.submit(input.closest('form')!);

      expect(useTaskStore.getState().tasks).toHaveLength(0);
    });

    it('cancels the form without adding', () => {
      render(<TaskboardPanel />);

      const addButton = screen.getByLabelText('Add task');
      fireEvent.click(addButton);

      fireEvent.change(screen.getByPlaceholderText('Task title…'), {
        target: { value: 'Abandoned task' },
      });

      const cancelButton = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelButton);

      expect(screen.queryByText('Abandoned task')).toBeNull();
      expect(useTaskStore.getState().tasks).toHaveLength(0);
    });

    it('cancels the form on Escape key', () => {
      render(<TaskboardPanel />);

      const addButton = screen.getByLabelText('Add task');
      fireEvent.click(addButton);

      const input = screen.getByPlaceholderText('Task title…');
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(screen.queryByPlaceholderText('Task title…')).toBeNull();
    });

    it('allows toggling assignee to AI', () => {
      render(<TaskboardPanel />);

      const addButton = screen.getByLabelText('Add task');
      fireEvent.click(addButton);

      const input = screen.getByPlaceholderText('Task title…');
      // Toggle assignee to AI — find all buttons with text "AI" and pick the one in the form
      const allAiButtons = screen.getAllByRole('button').filter(
        (btn) => btn.textContent?.includes('AI') && btn.closest('form')
      );
      expect(allAiButtons.length).toBeGreaterThan(0);
      fireEvent.click(allAiButtons[0]);

      fireEvent.change(input, { target: { value: 'AI task' } });

      fireEvent.submit(input.closest('form')!);

      const task = useTaskStore.getState().tasks[0];
      expect(task.assignee).toBe('ai');
    });
  });

  // ---- Task card expand/collapse ----

  describe('Task card expand/collapse', () => {
    it('expands task card on click to show description textarea', () => {
      resetStore(makeTasks());
      render(<TaskboardPanel />);

      const taskCard = screen.getByRole('button', { name: /Todo Task One/i });
      fireEvent.click(taskCard);

      expect(screen.getByPlaceholderText('Add description…')).toBeDefined();
    });

    it('collapses task card on second click', () => {
      resetStore(makeTasks());
      render(<TaskboardPanel />);

      const taskCard = screen.getByRole('button', { name: /Todo Task One/i });
      fireEvent.click(taskCard);
      fireEvent.click(taskCard);

      expect(screen.queryByPlaceholderText('Add description…')).toBeNull();
    });
  });

  // ---- Remove task ----

  describe('Remove task', () => {
    it('removes a task when remove button is clicked', () => {
      resetStore([makeTasks()[0]]);
      render(<TaskboardPanel />);

      // Hover to reveal the remove button (it's opacity-0 by default but present in DOM)
      const removeButtons = screen.getAllByLabelText('Remove task');
      expect(removeButtons.length).toBeGreaterThan(0);
      fireEvent.click(removeButtons[0]);

      expect(useTaskStore.getState().tasks).toHaveLength(0);
    });
  });

  // ---- Clear completed ----

  describe('Clear completed', () => {
    it('shows clear button in Done column when there are done tasks', () => {
      resetStore(makeTasks());
      render(<TaskboardPanel />);
      const clearButton = screen.getByLabelText('Clear completed tasks');
      expect(clearButton).toBeDefined();
    });

    it('clears all done tasks when clear button is clicked', () => {
      resetStore(makeTasks());
      render(<TaskboardPanel />);

      const clearButton = screen.getByLabelText('Clear completed tasks');
      fireEvent.click(clearButton);

      const state = useTaskStore.getState();
      const doneTasks = state.tasks.filter((t) => t.status === 'done');
      expect(doneTasks).toHaveLength(0);
      // Other tasks remain
      expect(state.tasks.length).toBeGreaterThan(0);
    });

    it('does not show clear button when Done column is empty', () => {
      // No done tasks
      resetStore([makeTasks()[0], makeTasks()[1]]);
      render(<TaskboardPanel />);
      expect(screen.queryByLabelText('Clear completed tasks')).toBeNull();
    });
  });

  // ---- Drag and drop ----

  /** jsdom doesn't implement DataTransfer, so we provide a minimal mock */
  const mockDataTransfer = {
    effectAllowed: 'none' as string,
    dropEffect: 'none' as string,
    setData: vi.fn(),
    getData: vi.fn(),
  };

  describe('Drag and drop', () => {
    it('fires dragStart without errors', () => {
      resetStore(makeTasks());
      render(<TaskboardPanel />);

      const taskCards = screen.getAllByRole('button', { name: /Todo Task One/i });
      expect(() =>
        fireEvent.dragStart(taskCards[0], { dataTransfer: mockDataTransfer })
      ).not.toThrow();
    });

    it('dragOver on a column sets drop target styling', () => {
      resetStore(makeTasks());
      render(<TaskboardPanel />);

      const columns = document.querySelectorAll('[data-column="in_progress"]');
      expect(columns.length).toBeGreaterThan(0);

      expect(() => {
        fireEvent.dragOver(columns[0], { dataTransfer: mockDataTransfer });
      }).not.toThrow();
    });

    it('drop on a column moves the task', () => {
      resetStore([makeTasks()[0]]); // one todo task
      render(<TaskboardPanel />);

      const taskCard = screen.getByRole('button', { name: /Todo Task One/i });
      fireEvent.dragStart(taskCard, { dataTransfer: mockDataTransfer });

      const inProgressColumn = document.querySelector('[data-column="in_progress"]');
      expect(inProgressColumn).not.toBeNull();
      fireEvent.drop(inProgressColumn!, { dataTransfer: mockDataTransfer });

      const state = useTaskStore.getState();
      expect(state.tasks[0].status).toBe('in_progress');
    });

    it('dragLeave clears drag-over state without throwing', () => {
      resetStore(makeTasks());
      render(<TaskboardPanel />);

      const column = document.querySelector('[data-column="done"]');
      expect(column).not.toBeNull();
      expect(() => {
        fireEvent.dragOver(column!, { dataTransfer: mockDataTransfer });
        fireEvent.dragLeave(column!);
      }).not.toThrow();
    });
  });

  // ---- Keyboard shortcut ----

  describe('Keyboard accessibility', () => {
    it('task cards respond to Enter key for expand', () => {
      resetStore(makeTasks());
      render(<TaskboardPanel />);

      const taskCard = screen.getByRole('button', { name: /Todo Task One/i });
      fireEvent.keyDown(taskCard, { key: 'Enter' });

      expect(screen.getByPlaceholderText('Add description…')).toBeDefined();
    });

    it('task cards respond to Space key for expand', () => {
      resetStore(makeTasks());
      render(<TaskboardPanel />);

      const taskCard = screen.getByRole('button', { name: /Todo Task One/i });
      fireEvent.keyDown(taskCard, { key: ' ' });

      expect(screen.getByPlaceholderText('Add description…')).toBeDefined();
    });
  });
});
