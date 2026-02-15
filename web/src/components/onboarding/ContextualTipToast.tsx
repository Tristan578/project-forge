'use client';

import { Lightbulb, X } from 'lucide-react';

interface ContextualTipToastProps {
  tip: {
    id: string;
    title: string;
    message: string;
    actionLabel?: string;
  };
  onDismiss: () => void;
  onAction?: () => void;
}

export function ContextualTipToast({ tip, onDismiss, onAction }: ContextualTipToastProps) {
  return (
    <div className="fixed bottom-24 right-6 z-40 animate-slide-up">
      <div className="bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl p-4 max-w-sm">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
            <Lightbulb className="w-4 h-4 text-white" />
          </div>

          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-zinc-100 mb-1">{tip.title}</h4>
            <p className="text-sm text-zinc-300 mb-3">{tip.message}</p>

            {tip.actionLabel && onAction && (
              <button
                onClick={onAction}
                className="text-sm text-blue-400 hover:text-blue-300 font-medium transition-colors"
              >
                {tip.actionLabel}
              </button>
            )}
          </div>

          <button
            onClick={onDismiss}
            className="p-1 hover:bg-zinc-700 rounded transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4 text-zinc-400" />
          </button>
        </div>
      </div>
    </div>
  );
}
