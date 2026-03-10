/**
 * TaskboardPanel — In-editor Kanban board for tracking user and AI tasks.
 *
 * Three columns: To Do | In Progress | Done
 * Each task card shows title, assignee badge, and progress bar for AI tasks.
 * Supports drag-and-drop between columns using the HTML5 Drag and Drop API.
 */

'use client';

import { useState, useCallback, useRef, type DragEvent } from 'react';
import {
  ListTodo,
  Loader2,
  CheckCircle2,
  Bot,
  User,
  Trash2,
  Plus,
  X,
  GripVertical,
} from 'lucide-react';
import { useTaskStore, type EditorTask, type TaskStatus, type TaskAssignee } from '@/stores/taskStore';

// ---- Column config ----

interface ColumnConfig {
  id: TaskStatus;
  label: string;
  color: string;
  icon: React.ReactNode;
}

const COLUMNS: ColumnConfig[] = [
  {
    id: 'todo',
    label: 'To Do',
    color: 'text-zinc-400',
    icon: <ListTodo size={13} />,
  },
  {
    id: 'in_progress',
    label: 'In Progress',
    color: 'text-blue-400',
    icon: <Loader2 size={13} className="animate-spin" />,
  },
  {
    id: 'done',
    label: 'Done',
    color: 'text-emerald-400',
    icon: <CheckCircle2 size={13} />,
  },
];

// ---- Assignee badge ----

function AssigneeBadge({ assignee }: { assignee: TaskAssignee }) {
  if (assignee === 'ai') {
    return (
      <span
        className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium bg-purple-900/60 text-purple-300"
        title="Assigned to AI"
      >
        <Bot size={9} />
        AI
      </span>
    );
  }
  return (
    <span
      className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium bg-zinc-700/60 text-zinc-300"
      title="Assigned to you"
    >
      <User size={9} />
      Me
    </span>
  );
}

// ---- Task card ----

interface TaskCardProps {
  task: EditorTask;
  onDragStart: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onRemove: (id: string) => void;
}

function TaskCard({ task, onDragStart, onRemove }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false);
  const updateTask = useTaskStore((s) => s.updateTask);

  const handleToggleExpand = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onRemove(task.id);
    },
    [onRemove, task.id]
  );

  const handleDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      onDragStart(e, task.id);
    },
    [onDragStart, task.id]
  );

  const handleDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateTask(task.id, { description: e.target.value });
    },
    [updateTask, task.id]
  );

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={handleToggleExpand}
      role="button"
      aria-expanded={expanded}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleToggleExpand();
        }
      }}
      className="group relative cursor-grab rounded border border-zinc-700/60 bg-zinc-800/80 p-2 text-left transition-colors hover:border-zinc-600 hover:bg-zinc-800 active:cursor-grabbing"
    >
      {/* Drag handle + title row */}
      <div className="flex items-start gap-1.5">
        <GripVertical
          size={12}
          className="mt-0.5 shrink-0 text-zinc-600 group-hover:text-zinc-500"
          aria-hidden="true"
        />
        <div className="flex flex-1 flex-col gap-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="truncate text-[11px] font-medium text-zinc-200">{task.title}</span>
            <div className="flex shrink-0 items-center gap-1">
              <AssigneeBadge assignee={task.assignee} />
              <button
                onClick={handleRemove}
                className="rounded p-0.5 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-400"
                title="Remove task"
                aria-label="Remove task"
              >
                <X size={10} />
              </button>
            </div>
          </div>

          {/* Progress bar for AI tasks */}
          {task.assignee === 'ai' && task.progress !== undefined && (
            <div className="h-1 w-full rounded-full bg-zinc-700">
              <div
                className="h-1 rounded-full bg-purple-500 transition-all"
                style={{ width: `${Math.min(100, Math.max(0, task.progress))}%` }}
                role="progressbar"
                aria-valuenow={task.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${task.progress}% complete`}
              />
            </div>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div
          className="mt-2 border-t border-zinc-700/50 pt-2"
          onClick={(e) => e.stopPropagation()}
        >
          <textarea
            value={task.description ?? ''}
            onChange={handleDescriptionChange}
            placeholder="Add description…"
            rows={3}
            className="w-full resize-none rounded bg-zinc-900/50 px-2 py-1 text-[10px] text-zinc-300 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
          />
          {task.result && (
            <p className="mt-1 text-[10px] text-emerald-400">{task.result}</p>
          )}
          <p className="mt-1 text-[9px] text-zinc-600">
            Created {new Date(task.createdAt).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}

// ---- Add task form ----

interface AddTaskFormProps {
  onAdd: (title: string, assignee: TaskAssignee) => void;
  onCancel: () => void;
}

function AddTaskForm({ onAdd, onCancel }: AddTaskFormProps) {
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState<TaskAssignee>('user');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = title.trim();
      if (!trimmed) return;
      onAdd(trimmed, assignee);
    },
    [title, assignee, onAdd]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    },
    [onCancel]
  );

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      className="rounded border border-zinc-600 bg-zinc-800 p-2"
    >
      <input
        ref={inputRef}
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title…"
        className="w-full rounded bg-zinc-900/50 px-2 py-1 text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
        aria-label="New task title"
      />
      <div className="mt-2 flex items-center gap-2">
        {/* Assignee toggle */}
        <div className="flex rounded border border-zinc-700 text-[9px]">
          <button
            type="button"
            onClick={() => setAssignee('user')}
            className={`flex items-center gap-0.5 px-1.5 py-0.5 transition-colors ${
              assignee === 'user'
                ? 'bg-zinc-600 text-zinc-200'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <User size={9} />
            Me
          </button>
          <button
            type="button"
            onClick={() => setAssignee('ai')}
            className={`flex items-center gap-0.5 px-1.5 py-0.5 transition-colors ${
              assignee === 'ai'
                ? 'bg-purple-800 text-purple-200'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Bot size={9} />
            AI
          </button>
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={onCancel}
          className="text-[10px] text-zinc-500 hover:text-zinc-300"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!title.trim()}
          className="rounded bg-blue-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-blue-500 disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </form>
  );
}

// ---- Column ----

interface ColumnProps {
  config: ColumnConfig;
  tasks: EditorTask[];
  isDragOver: boolean;
  onDragOver: (e: DragEvent<HTMLDivElement>, status: TaskStatus) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent<HTMLDivElement>, status: TaskStatus) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onRemove: (id: string) => void;
  onClearCompleted?: () => void;
  onAdd: (title: string, assignee: TaskAssignee) => void;
}

function Column({
  config,
  tasks,
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
  onRemove,
  onClearCompleted,
  onAdd,
}: ColumnProps) {
  const [showForm, setShowForm] = useState(false);

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      onDragOver(e, config.id);
    },
    [onDragOver, config.id]
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      onDrop(e, config.id);
    },
    [onDrop, config.id]
  );

  const handleAdd = useCallback(
    (title: string, assignee: TaskAssignee) => {
      onAdd(title, assignee);
      setShowForm(false);
    },
    [onAdd]
  );

  const handleShowForm = useCallback(() => {
    setShowForm(true);
  }, []);

  const handleCancelForm = useCallback(() => {
    setShowForm(false);
  }, []);

  return (
    <div
      className={`flex flex-col gap-1 min-w-0 flex-1 rounded border transition-colors ${
        isDragOver
          ? 'border-blue-500/50 bg-blue-950/20'
          : 'border-transparent'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={onDragLeave}
      onDrop={handleDrop}
      data-column={config.id}
      aria-label={`${config.label} column`}
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-1 py-0.5">
        <div className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${config.color}`}>
          {config.icon}
          <span>{config.label}</span>
          <span className="ml-0.5 rounded bg-zinc-700/60 px-1 text-[9px] text-zinc-400">
            {tasks.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {onClearCompleted && tasks.length > 0 && (
            <button
              onClick={onClearCompleted}
              className="rounded p-0.5 text-zinc-600 hover:text-red-400"
              title="Clear completed tasks"
              aria-label="Clear completed tasks"
            >
              <Trash2 size={11} />
            </button>
          )}
          {config.id === 'todo' && (
            <button
              onClick={handleShowForm}
              className="rounded p-0.5 text-zinc-600 hover:text-zinc-300"
              title="Add task"
              aria-label="Add task"
            >
              <Plus size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Task cards */}
      <div className="flex flex-col gap-1 min-h-[40px]">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onDragStart={onDragStart}
            onRemove={onRemove}
          />
        ))}
      </div>

      {/* Add task inline form */}
      {showForm && config.id === 'todo' && (
        <AddTaskForm onAdd={handleAdd} onCancel={handleCancelForm} />
      )}

      {/* Drop zone hint */}
      {isDragOver && tasks.length === 0 && (
        <div className="flex h-10 items-center justify-center rounded border border-dashed border-blue-500/40 text-[10px] text-blue-400/60">
          Drop here
        </div>
      )}
    </div>
  );
}

// ---- Main panel ----

export function TaskboardPanel() {
  const tasks = useTaskStore((s) => s.tasks);
  const addTask = useTaskStore((s) => s.addTask);
  const moveTask = useTaskStore((s) => s.moveTask);
  const removeTask = useTaskStore((s) => s.removeTask);
  const clearCompleted = useTaskStore((s) => s.clearCompleted);

  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);
  const dragTaskId = useRef<string | null>(null);

  const handleDragStart = useCallback((e: DragEvent<HTMLDivElement>, id: string) => {
    dragTaskId.current = id;
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>, status: TaskStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(status);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverColumn(null);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>, status: TaskStatus) => {
      e.preventDefault();
      setDragOverColumn(null);
      if (dragTaskId.current) {
        moveTask(dragTaskId.current, status);
        dragTaskId.current = null;
      }
    },
    [moveTask]
  );

  const handleAdd = useCallback(
    (title: string, assignee: TaskAssignee) => {
      addTask(title, undefined, assignee);
    },
    [addTask]
  );

  const handleRemove = useCallback(
    (id: string) => {
      removeTask(id);
    },
    [removeTask]
  );

  const byStatus = (status: TaskStatus) => tasks.filter((t) => t.status === status);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-900">
      {/* Panel header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <ListTodo size={14} className="text-zinc-400" />
        <span className="text-xs font-semibold text-zinc-300">Tasks</span>
        <span className="ml-auto text-[10px] text-zinc-600">{tasks.length} total</span>
      </div>

      {/* Kanban columns */}
      <div className="flex flex-1 gap-2 overflow-y-auto p-2">
        {COLUMNS.map((col) => (
          <Column
            key={col.id}
            config={col}
            tasks={byStatus(col.id)}
            isDragOver={dragOverColumn === col.id}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onDragStart={handleDragStart}
            onRemove={handleRemove}
            onAdd={handleAdd}
            onClearCompleted={col.id === 'done' ? clearCompleted : undefined}
          />
        ))}
      </div>
    </div>
  );
}
