/**
 * Editor Taskboard Store
 *
 * Manages in-editor tasks for tracking what the user and AI are doing.
 * Persisted to localStorage so tasks survive page refreshes.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskAssignee = 'user' | 'ai';

export interface EditorTask {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignee: TaskAssignee;
  createdAt: number;
  updatedAt: number;
  /** 0-100 progress indicator, primarily for AI tasks */
  progress?: number;
  /** Completion message set when the task is done */
  result?: string;
}

interface TaskState {
  tasks: EditorTask[];
  /**
   * Add a new task and return its generated ID.
   */
  addTask: (title: string, description?: string, assignee?: TaskAssignee) => string;
  updateTask: (id: string, updates: Partial<Omit<EditorTask, 'id' | 'createdAt'>>) => void;
  moveTask: (id: string, status: TaskStatus) => void;
  removeTask: (id: string) => void;
  clearCompleted: () => void;
}

export const useTaskStore = create<TaskState>()(
  persist(
    (set, get) => ({
      tasks: [],

      addTask: (title, description, assignee = 'user') => {
        const id = crypto.randomUUID();
        const now = Date.now();
        const task: EditorTask = {
          id,
          title,
          description,
          status: 'todo',
          assignee,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ tasks: [...s.tasks, task] }));
        return id;
      },

      updateTask: (id, updates) => {
        if (!get().tasks.some((t) => t.id === id)) return;
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, ...updates, updatedAt: Date.now() } : t
          ),
        }));
      },

      moveTask: (id, status) => {
        const task = get().tasks.find((t) => t.id === id);
        if (!task) return;
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, status, updatedAt: Date.now() } : t
          ),
        }));
      },

      removeTask: (id) => {
        set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
      },

      clearCompleted: () => {
        set((s) => ({ tasks: s.tasks.filter((t) => t.status !== 'done') }));
      },
    }),
    {
      name: 'spawnforge-editor-tasks',
    }
  )
);
