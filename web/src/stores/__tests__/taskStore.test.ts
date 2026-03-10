/**
 * Unit tests for taskStore — in-editor Kanban board store.
 *
 * Covers CRUD operations, persistence via localStorage, ID generation,
 * and graceful handling of invalid operations.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTaskStore, type EditorTask, type TaskStatus } from '../taskStore';

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

// ---- Mock crypto.randomUUID ----
let uuidCounter = 0;

// Helper: reset store to empty state before each test
function resetStore() {
  useTaskStore.setState({ tasks: [] });
  localStorageMock.clear();
  uuidCounter = 0;
}

describe('taskStore', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', {
      randomUUID: () => `test-uuid-${++uuidCounter}`,
    });
    vi.stubGlobal('localStorage', localStorageMock);
    vi.useFakeTimers();
    resetStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ---- Initial state ----

  describe('Initial State', () => {
    it('starts with an empty tasks array', () => {
      expect(useTaskStore.getState().tasks).toEqual([]);
    });
  });

  // ---- addTask ----

  describe('addTask', () => {
    it('adds a task with default assignee "user"', () => {
      const { addTask } = useTaskStore.getState();
      const id = addTask('My task');

      const state = useTaskStore.getState();
      expect(state.tasks).toHaveLength(1);
      expect(state.tasks[0]).toMatchObject({
        id,
        title: 'My task',
        status: 'todo',
        assignee: 'user',
      });
    });

    it('returns a non-empty string ID', () => {
      const { addTask } = useTaskStore.getState();
      const id = addTask('Task A');
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('each addTask call produces a unique ID', () => {
      const { addTask } = useTaskStore.getState();
      const id1 = addTask('Task 1');
      const id2 = addTask('Task 2');
      expect(id1).not.toBe(id2);
    });

    it('accepts an optional description', () => {
      const { addTask } = useTaskStore.getState();
      addTask('Task with desc', 'Some description');

      const task = useTaskStore.getState().tasks[0];
      expect(task.description).toBe('Some description');
    });

    it('accepts assignee "ai"', () => {
      const { addTask } = useTaskStore.getState();
      addTask('AI task', undefined, 'ai');

      const task = useTaskStore.getState().tasks[0];
      expect(task.assignee).toBe('ai');
    });

    it('defaults status to "todo"', () => {
      const { addTask } = useTaskStore.getState();
      addTask('New task');
      expect(useTaskStore.getState().tasks[0].status).toBe('todo');
    });

    it('sets createdAt and updatedAt timestamps', () => {
      const before = Date.now();
      const { addTask } = useTaskStore.getState();
      addTask('Timestamped task');
      const after = Date.now();

      const task = useTaskStore.getState().tasks[0];
      expect(task.createdAt).toBeGreaterThanOrEqual(before);
      expect(task.createdAt).toBeLessThanOrEqual(after);
      expect(task.updatedAt).toBeGreaterThanOrEqual(before);
    });

    it('appends to existing tasks', () => {
      const { addTask } = useTaskStore.getState();
      addTask('First');
      addTask('Second');
      addTask('Third');
      expect(useTaskStore.getState().tasks).toHaveLength(3);
    });
  });

  // ---- updateTask ----

  describe('updateTask', () => {
    it('updates task title', () => {
      const { addTask, updateTask } = useTaskStore.getState();
      const id = addTask('Original');

      updateTask(id, { title: 'Updated' });

      const task = useTaskStore.getState().tasks.find((t) => t.id === id);
      expect(task?.title).toBe('Updated');
    });

    it('updates task description', () => {
      const { addTask, updateTask } = useTaskStore.getState();
      const id = addTask('Task');

      updateTask(id, { description: 'New description' });

      const task = useTaskStore.getState().tasks.find((t) => t.id === id);
      expect(task?.description).toBe('New description');
    });

    it('updates progress for AI tasks', () => {
      const { addTask, updateTask } = useTaskStore.getState();
      const id = addTask('AI task', undefined, 'ai');

      updateTask(id, { progress: 75 });

      const task = useTaskStore.getState().tasks.find((t) => t.id === id);
      expect(task?.progress).toBe(75);
    });

    it('updates result field', () => {
      const { addTask, updateTask } = useTaskStore.getState();
      const id = addTask('Task');

      updateTask(id, { result: 'Completed successfully' });

      const task = useTaskStore.getState().tasks.find((t) => t.id === id);
      expect(task?.result).toBe('Completed successfully');
    });

    it('bumps updatedAt on update', async () => {
      const { addTask, updateTask } = useTaskStore.getState();
      const id = addTask('Task');
      const originalUpdatedAt = useTaskStore.getState().tasks[0].updatedAt;

      // Ensure time moves forward
      vi.advanceTimersByTime(2);
      updateTask(id, { title: 'Changed' });

      const task = useTaskStore.getState().tasks.find((t) => t.id === id);
      expect(task?.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });

    it('does not affect other tasks', () => {
      const { addTask, updateTask } = useTaskStore.getState();
      addTask('Task A');
      const idB = addTask('Task B');

      updateTask(idB, { title: 'Task B Changed' });

      const taskA = useTaskStore.getState().tasks[0];
      expect(taskA.title).toBe('Task A');
    });

    it('silently ignores update for nonexistent ID', () => {
      const { addTask, updateTask } = useTaskStore.getState();
      addTask('Real task');

      // Should not throw
      expect(() => updateTask('nonexistent-id', { title: 'Ghost' })).not.toThrow();
      // Tasks unchanged
      expect(useTaskStore.getState().tasks).toHaveLength(1);
    });
  });

  // ---- moveTask ----

  describe('moveTask', () => {
    it('moves a task from todo to in_progress', () => {
      const { addTask, moveTask } = useTaskStore.getState();
      const id = addTask('Task');

      moveTask(id, 'in_progress');

      const task = useTaskStore.getState().tasks.find((t) => t.id === id);
      expect(task?.status).toBe('in_progress');
    });

    it('moves a task to done', () => {
      const { addTask, moveTask } = useTaskStore.getState();
      const id = addTask('Task');

      moveTask(id, 'done');

      const task = useTaskStore.getState().tasks.find((t) => t.id === id);
      expect(task?.status).toBe('done');
    });

    it('moves a task back to todo', () => {
      const { addTask, moveTask } = useTaskStore.getState();
      const id = addTask('Task');
      moveTask(id, 'done');

      moveTask(id, 'todo');

      const task = useTaskStore.getState().tasks.find((t) => t.id === id);
      expect(task?.status).toBe('todo');
    });

    it('does not affect other tasks when moving', () => {
      const { addTask, moveTask } = useTaskStore.getState();
      const idA = addTask('Task A');
      addTask('Task B');

      moveTask(idA, 'done');

      const taskB = useTaskStore.getState().tasks[1];
      expect(taskB.status).toBe('todo');
    });

    it('silently ignores move for nonexistent ID', () => {
      const { addTask, moveTask } = useTaskStore.getState();
      addTask('Real task');

      expect(() => moveTask('does-not-exist', 'done')).not.toThrow();
      expect(useTaskStore.getState().tasks[0].status).toBe('todo');
    });

    it('cycles through all valid statuses', () => {
      const { addTask, moveTask } = useTaskStore.getState();
      const id = addTask('Cycle task');

      const statuses: TaskStatus[] = ['todo', 'in_progress', 'done'];
      for (const status of statuses) {
        moveTask(id, status);
        const task = useTaskStore.getState().tasks.find((t) => t.id === id);
        expect(task?.status).toBe(status);
      }
    });
  });

  // ---- removeTask ----

  describe('removeTask', () => {
    it('removes a task by ID', () => {
      const { addTask, removeTask } = useTaskStore.getState();
      const id = addTask('To be removed');

      removeTask(id);

      expect(useTaskStore.getState().tasks).toHaveLength(0);
    });

    it('only removes the specified task', () => {
      const { addTask, removeTask } = useTaskStore.getState();
      addTask('Keep A');
      const idRemove = addTask('Remove me');
      addTask('Keep B');

      removeTask(idRemove);

      const remaining = useTaskStore.getState().tasks;
      expect(remaining).toHaveLength(2);
      expect(remaining.map((t) => t.title)).toEqual(['Keep A', 'Keep B']);
    });

    it('silently ignores remove for nonexistent ID', () => {
      const { addTask, removeTask } = useTaskStore.getState();
      addTask('Existing');

      expect(() => removeTask('ghost-id')).not.toThrow();
      expect(useTaskStore.getState().tasks).toHaveLength(1);
    });
  });

  // ---- clearCompleted ----

  describe('clearCompleted', () => {
    it('removes all done tasks', () => {
      const { addTask, clearCompleted } = useTaskStore.getState();
      const idDoneA = addTask('Done A');
      const idDoneB = addTask('Done B');
      const idTodo = addTask('Still todo');

      useTaskStore.getState().moveTask(idDoneA, 'done');
      useTaskStore.getState().moveTask(idDoneB, 'done');

      clearCompleted();

      const remaining = useTaskStore.getState().tasks;
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(idTodo);
    });

    it('does not affect todo or in_progress tasks', () => {
      const { addTask, clearCompleted } = useTaskStore.getState();
      addTask('Todo task');
      const idInProgress = addTask('In progress task');
      const idDone = addTask('Done task');

      useTaskStore.getState().moveTask(idInProgress, 'in_progress');
      useTaskStore.getState().moveTask(idDone, 'done');

      clearCompleted();

      const remaining = useTaskStore.getState().tasks;
      expect(remaining).toHaveLength(2);
      expect(remaining.map((t) => t.status)).toEqual(['todo', 'in_progress']);
    });

    it('is a no-op when no tasks are done', () => {
      const { addTask, clearCompleted } = useTaskStore.getState();
      addTask('Task A');
      addTask('Task B');

      clearCompleted();

      expect(useTaskStore.getState().tasks).toHaveLength(2);
    });

    it('handles empty task list', () => {
      const { clearCompleted } = useTaskStore.getState();
      expect(() => clearCompleted()).not.toThrow();
      expect(useTaskStore.getState().tasks).toHaveLength(0);
    });
  });

  // ---- Task data integrity ----

  describe('Task data integrity', () => {
    it('preserves createdAt across updates', async () => {
      const { addTask, updateTask } = useTaskStore.getState();
      const id = addTask('Task');
      const originalCreatedAt = useTaskStore.getState().tasks[0].createdAt;

      vi.advanceTimersByTime(2);
      updateTask(id, { title: 'Updated title' });

      const task = useTaskStore.getState().tasks.find((t) => t.id === id);
      expect(task?.createdAt).toBe(originalCreatedAt);
    });

    it('can store task with all optional fields', () => {
      const { addTask, updateTask } = useTaskStore.getState();
      const id = addTask('Full task', 'description here', 'ai');

      updateTask(id, { progress: 42, result: 'Done!' });

      const task = useTaskStore.getState().tasks.find((t) => t.id === id) as EditorTask;
      expect(task.description).toBe('description here');
      expect(task.assignee).toBe('ai');
      expect(task.progress).toBe(42);
      expect(task.result).toBe('Done!');
    });

    it('multiple tasks maintain correct order', () => {
      const { addTask } = useTaskStore.getState();
      const titles = ['Alpha', 'Beta', 'Gamma', 'Delta'];
      titles.forEach((t) => addTask(t));

      const stored = useTaskStore.getState().tasks.map((t) => t.title);
      expect(stored).toEqual(titles);
    });
  });

  // ---- Persistence ----

  describe('Persistence', () => {
    it('calls localStorage.setItem when tasks change', () => {
      const { addTask } = useTaskStore.getState();
      addTask('Persisted task');

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'spawnforge-editor-tasks',
        expect.any(String)
      );
    });

    it('persisted data contains task state', () => {
      const { addTask } = useTaskStore.getState();
      addTask('Check persistence');

      const lastCall = localStorageMock.setItem.mock.calls.find(
        ([key]: [string, string]) => key === 'spawnforge-editor-tasks'
      );
      expect(lastCall).toBeDefined();
      const stored = JSON.parse(lastCall![1]);
      expect(stored.state.tasks).toHaveLength(1);
      expect(stored.state.tasks[0].title).toBe('Check persistence');
    });
  });
});
