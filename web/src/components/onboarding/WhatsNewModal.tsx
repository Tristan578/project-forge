'use client';

import { CheckCircle2 } from 'lucide-react';
import { useOnboardingStore } from '@/stores/onboardingStore';

const recentFeatures = [
  {
    title: 'Visual Scripting',
    description: 'Build game logic with a node-based visual editor',
  },
  {
    title: 'Cloud Publishing',
    description: 'Share your games instantly with shareable URLs',
  },
  {
    title: 'Mobile Touch Controls',
    description: 'Virtual joystick and buttons for mobile gameplay',
  },
  {
    title: 'Dialogue System',
    description: 'Create branching conversations with a visual tree editor',
  },
  {
    title: '2D Game Engine',
    description: 'Build 2D games with sprites, tilemaps, and skeletal animation',
  },
  {
    title: 'AI Asset Generation',
    description: 'Generate 3D models, textures, audio, and music with AI',
  },
];

export function WhatsNewModal() {
  const { showWhatsNew, dismissWhatsNew } = useOnboardingStore();

  if (!showWhatsNew) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 rounded-lg shadow-2xl max-w-lg w-full">
        <div className="p-6 border-b border-zinc-800">
          <h2 className="text-2xl font-bold text-zinc-100">What&apos;s New</h2>
          <p className="text-zinc-400 mt-2">
            Welcome back! Here are some exciting features we have added recently.
          </p>
        </div>

        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
          {recentFeatures.map((feature, index) => (
            <div key={index} className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-zinc-100 mb-1">{feature.title}</h3>
                <p className="text-sm text-zinc-400">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="p-6 border-t border-zinc-800 flex justify-end">
          <button
            onClick={dismissWhatsNew}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
