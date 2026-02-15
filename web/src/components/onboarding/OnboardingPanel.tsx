'use client';

import { X, CheckCircle2, Circle, Lock } from 'lucide-react';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { TUTORIALS } from '@/data/tutorials';
import { ONBOARDING_TASKS } from '@/data/onboardingTasks';
import { ACHIEVEMENTS } from '@/data/achievements';
import * as Icons from 'lucide-react';

export function OnboardingPanel() {
  const {
    showOnboardingPanel,
    setShowOnboardingPanel,
    tutorialCompleted,
    basicTasks,
    advancedTasks,
    unlockedAchievements,
    startTutorial,
  } = useOnboardingStore();

  if (!showOnboardingPanel) return null;

  const basicTasksArray = ONBOARDING_TASKS.filter(t => t.category === 'basic');
  const advancedTasksArray = ONBOARDING_TASKS.filter(t => t.category === 'advanced');

  const basicProgress = Object.keys(basicTasks).length / basicTasksArray.length;
  const advancedProgress = Object.keys(advancedTasks).length / advancedTasksArray.length;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-zinc-900 border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-zinc-100">Getting Started</h2>
          <button
            onClick={() => setShowOnboardingPanel(false)}
            className="p-1 hover:bg-zinc-800 rounded transition-colors"
          >
            <X className="w-5 h-5 text-zinc-400" />
          </button>
        </div>

        <div className="p-6 space-y-8">
          <section>
            <h3 className="text-lg font-semibold text-zinc-100 mb-4">Tutorials</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {TUTORIALS.map((tutorial) => {
                const isCompleted = tutorialCompleted[tutorial.id];
                return (
                  <button
                    key={tutorial.id}
                    onClick={() => startTutorial(tutorial.id)}
                    className="bg-zinc-800 hover:bg-zinc-750 rounded-lg p-4 text-left transition-colors border border-zinc-700 hover:border-zinc-600"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="font-semibold text-zinc-100">{tutorial.name}</h4>
                      {isCompleted ? (
                        <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                      ) : (
                        <Circle className="w-5 h-5 text-zinc-600 flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-sm text-zinc-400 mb-3">{tutorial.description}</p>
                    <div className="flex items-center gap-3 text-xs text-zinc-500">
                      <span className="capitalize">{tutorial.difficulty}</span>
                      <span>•</span>
                      <span>{tutorial.estimatedMinutes} min</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-zinc-100 mb-4">Feature Checklist</h3>

            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-zinc-300">Basic Skills</h4>
                <span className="text-sm text-zinc-400">
                  {Object.keys(basicTasks).length} / {basicTasksArray.length}
                </span>
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-2 mb-4">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${basicProgress * 100}%` }}
                />
              </div>
              <div className="space-y-2">
                {basicTasksArray.map((task) => {
                  const isCompleted = basicTasks[task.id];
                  return (
                    <div
                      key={task.id}
                      className="flex items-start gap-3 p-3 bg-zinc-800 rounded border border-zinc-700"
                    >
                      {isCompleted ? (
                        <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      ) : (
                        <Circle className="w-5 h-5 text-zinc-600 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-zinc-200">{task.label}</div>
                        <div className="text-sm text-zinc-400">{task.description}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-zinc-300">Advanced Skills</h4>
                <span className="text-sm text-zinc-400">
                  {Object.keys(advancedTasks).length} / {advancedTasksArray.length}
                </span>
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-2 mb-4">
                <div
                  className="bg-purple-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${advancedProgress * 100}%` }}
                />
              </div>
              <div className="space-y-2">
                {advancedTasksArray.map((task) => {
                  const isCompleted = advancedTasks[task.id];
                  return (
                    <div
                      key={task.id}
                      className="flex items-start gap-3 p-3 bg-zinc-800 rounded border border-zinc-700"
                    >
                      {isCompleted ? (
                        <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      ) : (
                        <Circle className="w-5 h-5 text-zinc-600 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-zinc-200">{task.label}</div>
                        <div className="text-sm text-zinc-400">{task.description}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-zinc-100 mb-4">Achievements</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {ACHIEVEMENTS.map((achievement) => {
                const isUnlocked = unlockedAchievements.includes(achievement.id);
                const IconComponent = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[achievement.icon];

                const tierColors = {
                  bronze: 'from-amber-700 to-amber-900',
                  silver: 'from-zinc-400 to-zinc-600',
                  gold: 'from-yellow-500 to-yellow-700',
                };

                return (
                  <div
                    key={achievement.id}
                    className={`relative bg-zinc-800 rounded-lg p-4 border ${
                      isUnlocked
                        ? 'border-zinc-600'
                        : 'border-zinc-700 opacity-50'
                    }`}
                  >
                    {!isUnlocked && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg">
                        <Lock className="w-6 h-6 text-zinc-500" />
                      </div>
                    )}
                    <div
                      className={`w-12 h-12 rounded-full bg-gradient-to-br ${
                        tierColors[achievement.tier]
                      } flex items-center justify-center mb-3 mx-auto`}
                    >
                      {IconComponent && <IconComponent className="w-6 h-6 text-white" />}
                    </div>
                    <h4 className="font-semibold text-zinc-100 text-center text-sm mb-1">
                      {achievement.name}
                    </h4>
                    <p className="text-xs text-zinc-400 text-center">
                      {achievement.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
