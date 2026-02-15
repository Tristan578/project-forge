'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { ACHIEVEMENTS } from '@/data/achievements';
import * as Icons from 'lucide-react';

export function AchievementToast() {
  const {
    showAchievementToast,
    lastAchievementShown,
    dismissAchievementToast,
  } = useOnboardingStore();

  const achievement = ACHIEVEMENTS.find(a => a.id === lastAchievementShown);

  useEffect(() => {
    if (showAchievementToast) {
      const timer = setTimeout(() => {
        dismissAchievementToast();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [showAchievementToast, dismissAchievementToast]);

  if (!showAchievementToast || !achievement) return null;

  const IconComponent = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[achievement.icon];

  const tierColors = {
    bronze: 'from-amber-700 to-amber-900',
    silver: 'from-zinc-400 to-zinc-600',
    gold: 'from-yellow-500 to-yellow-700',
  };

  const tierBadges = {
    bronze: 'bg-amber-700 text-amber-100',
    silver: 'bg-zinc-400 text-zinc-900',
    gold: 'bg-yellow-500 text-yellow-950',
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-slide-up">
      <div
        className={`bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl p-4 max-w-sm ${
          achievement.tier === 'gold' ? 'animate-shimmer' : ''
        }`}
      >
        <div className="flex items-start gap-4">
          <div
            className={`w-14 h-14 rounded-full bg-gradient-to-br ${
              tierColors[achievement.tier]
            } flex items-center justify-center flex-shrink-0`}
          >
            {IconComponent && <IconComponent className="w-7 h-7 text-white" />}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-semibold text-zinc-100">Achievement Unlocked!</h4>
              <span
                className={`text-xs px-2 py-0.5 rounded ${
                  tierBadges[achievement.tier]
                } uppercase font-bold tracking-wide`}
              >
                {achievement.tier}
              </span>
            </div>
            <p className="font-medium text-zinc-200 mb-1">{achievement.name}</p>
            <p className="text-sm text-zinc-400">{achievement.description}</p>
          </div>

          <button
            onClick={dismissAchievementToast}
            className="p-1 hover:bg-zinc-800 rounded transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4 text-zinc-400" />
          </button>
        </div>
      </div>
    </div>
  );
}
