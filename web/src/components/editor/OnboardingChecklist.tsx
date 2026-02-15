/**
 * Onboarding checklist panel showing getting-started tasks.
 * Auto-completes tasks based on user actions and tracks progress.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, Circle, ChevronDown, ChevronUp, X, Trophy } from 'lucide-react';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useEditorStore } from '@/stores/editorStore';
import { useChatStore } from '@/stores/chatStore';

interface ChecklistTask {
  id: string;
  title: string;
  description: string;
  category: 'basics' | 'advanced';
  checkCompletion: (state: ReturnType<typeof useEditorStore.getState>) => boolean;
}

const CHECKLIST_TASKS: ChecklistTask[] = [
  {
    id: 'create-entity',
    title: 'Create Your First Entity',
    description: 'Add any entity to your scene',
    category: 'basics',
    checkCompletion: (state) => Object.keys(state.sceneGraph.nodes).length > 1, // Excluding camera
  },
  {
    id: 'customize-material',
    title: 'Customize a Material',
    description: 'Change a material color or texture',
    category: 'basics',
    checkCompletion: (state) => {
      if (!state.primaryMaterial) return false;
      const [r, g, b] = state.primaryMaterial.baseColor;
      // Check if color changed from default gray (0.5, 0.5, 0.5)
      return r !== 0.5 || g !== 0.5 || b !== 0.5;
    },
  },
  {
    id: 'add-physics',
    title: 'Add Physics',
    description: 'Enable physics on an entity',
    category: 'basics',
    checkCompletion: (state) => state.physicsEnabled,
  },
  {
    id: 'write-script',
    title: 'Write a Script',
    description: 'Add a script to any entity',
    category: 'basics',
    checkCompletion: (state) =>
      Object.values(state.allScripts).some((s) => s.source.trim().length > 50),
  },
  {
    id: 'use-ai-chat',
    title: 'Use AI Chat',
    description: 'Send a message to the AI assistant',
    category: 'basics',
    checkCompletion: () =>
      useChatStore.getState().messages.filter((m) => m.role === 'user').length > 0,
  },
  {
    id: 'export-game',
    title: 'Export Your Game',
    description: 'Export your game as a standalone file',
    category: 'basics',
    checkCompletion: () => {
      // Export success tracked via cloudSaveStatus or isExporting completed
      const state = useEditorStore.getState();
      return state.cloudSaveStatus === 'saved';
    },
  },
  {
    id: 'create-prefab',
    title: 'Create a Prefab',
    description: 'Save an entity as a reusable prefab',
    category: 'advanced',
    checkCompletion: () => {
      // Prefabs tracked via scene modifications (simplified check)
      return false; // TODO: Add prefab count to EditorState
    },
  },
  {
    id: 'add-particles',
    title: 'Add Particle Effects',
    description: 'Add a particle system to your scene',
    category: 'advanced',
    checkCompletion: (state) => state.particleEnabled,
  },
  {
    id: 'add-audio',
    title: 'Add Audio',
    description: 'Add an audio component to an entity',
    category: 'advanced',
    checkCompletion: (state) => state.primaryAudio !== null,
  },
  {
    id: 'build-ui',
    title: 'Build a UI Screen',
    description: 'Create a UI widget',
    category: 'advanced',
    checkCompletion: (state) => state.hudElements.length > 0,
  },
  {
    id: 'add-animation',
    title: 'Use Skeletal Animation',
    description: 'Load a GLTF model with animation',
    category: 'advanced',
    checkCompletion: (state) => state.primaryAnimationClip !== null,
  },
  {
    id: 'publish-game',
    title: 'Publish to Cloud',
    description: 'Publish your game to the cloud',
    category: 'advanced',
    checkCompletion: (state) => state.projectId !== null && state.cloudSaveStatus === 'saved',
  },
];

const STORAGE_KEY = 'forge-checklist-dismissed';

export function OnboardingChecklist() {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof localStorage === 'undefined') return true;
    return !!localStorage.getItem(STORAGE_KEY);
  });
  const [collapsed, setCollapsed] = useState(false);
  const [completedTasks, setCompletedTasks] = useState<Set<string>>(new Set());

  const tutorialCompleted = useOnboardingStore((s) => s.tutorialCompleted);
  const hasCompletedOnboarding = Object.keys(tutorialCompleted).length > 0;

  // Auto-dismiss if user completed onboarding via tutorial
  const [prevOnboarded, setPrevOnboarded] = useState(hasCompletedOnboarding);
  if (prevOnboarded !== hasCompletedOnboarding) {
    setPrevOnboarded(hasCompletedOnboarding);
    if (hasCompletedOnboarding && !dismissed) {
      setDismissed(true);
      localStorage.setItem(STORAGE_KEY, '1');
    }
  }

  // Check task completion on editor state changes
  useEffect(() => {
    const unsubscribe = useEditorStore.subscribe((state) => {
      const newCompleted = new Set<string>();

      CHECKLIST_TASKS.forEach((task) => {
        if (task.checkCompletion(state)) {
          newCompleted.add(task.id);
        }
      });

      setCompletedTasks(newCompleted);
    });

    return unsubscribe;
  }, []);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    localStorage.setItem(STORAGE_KEY, '1');
  }, []);

  if (dismissed) return null;

  const basicsTasks = CHECKLIST_TASKS.filter((t) => t.category === 'basics');
  const advancedTasks = CHECKLIST_TASKS.filter((t) => t.category === 'advanced');

  const basicsCompleted = basicsTasks.filter((t) => completedTasks.has(t.id)).length;
  const advancedCompleted = advancedTasks.filter((t) => completedTasks.has(t.id)).length;
  const totalCompleted = completedTasks.size;
  const totalTasks = CHECKLIST_TASKS.length;
  const basicsAllDone = basicsCompleted === basicsTasks.length;

  const progressPercent = Math.round((totalCompleted / totalTasks) * 100);

  return (
    <div className="fixed bottom-4 left-4 z-30 w-80 rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-blue-400" />
          <span className="text-sm font-semibold text-zinc-200">Getting Started</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="rounded p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button
            onClick={handleDismiss}
            className="rounded p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Dismiss checklist"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Progress bar */}
          <div className="border-b border-zinc-800 px-3 py-2">
            <div className="mb-1 flex items-center justify-between text-xs text-zinc-400">
              <span>Progress</span>
              <span>
                {totalCompleted} / {totalTasks}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Task lists */}
          <div className="max-h-96 overflow-y-auto px-3 py-2">
            {/* Basics */}
            <div className="mb-3">
              <div className="mb-2 flex items-center gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Basics
                </h4>
                <span className="text-xs text-zinc-500">
                  {basicsCompleted}/{basicsTasks.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {basicsTasks.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    completed={completedTasks.has(task.id)}
                  />
                ))}
              </div>
            </div>

            {/* Advanced (locked until basics done) */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Advanced
                </h4>
                {!basicsAllDone && (
                  <span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-xs text-amber-400">
                    Locked
                  </span>
                )}
                {basicsAllDone && (
                  <span className="text-xs text-zinc-500">
                    {advancedCompleted}/{advancedTasks.length}
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                {advancedTasks.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    completed={completedTasks.has(task.id)}
                    locked={!basicsAllDone}
                  />
                ))}
              </div>
            </div>

            {/* All done message */}
            {totalCompleted === totalTasks && (
              <div className="mt-3 rounded border border-green-700/50 bg-green-900/20 px-3 py-2 text-xs text-green-300">
                <div className="flex items-center gap-2">
                  <Trophy size={14} className="text-green-400" />
                  <span className="font-semibold">All tasks complete!</span>
                </div>
                <p className="mt-1 text-green-400/80">
                  You&apos;ve explored all the core features. Keep building!
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TaskItem({
  task,
  completed,
  locked = false,
}: {
  task: ChecklistTask;
  completed: boolean;
  locked?: boolean;
}) {
  return (
    <div
      className={`flex items-start gap-2 rounded px-2 py-1.5 transition-colors ${
        locked
          ? 'opacity-40'
          : completed
            ? 'bg-green-900/20'
            : 'hover:bg-zinc-800'
      }`}
    >
      {completed ? (
        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-green-500" />
      ) : (
        <Circle size={16} className="mt-0.5 shrink-0 text-zinc-600" />
      )}
      <div className="flex-1">
        <div
          className={`text-sm font-medium ${
            completed ? 'text-zinc-400 line-through' : 'text-zinc-300'
          }`}
        >
          {task.title}
        </div>
        <div className="text-xs text-zinc-500">{task.description}</div>
      </div>
    </div>
  );
}
