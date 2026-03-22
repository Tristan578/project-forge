'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { X } from 'lucide-react';

export interface CelebrationProps {
  title: string;
  message: string;
  onDismiss: () => void;
}

/** Duration in ms before the overlay auto-dismisses. */
const AUTO_DISMISS_MS = 5000;

/**
 * A full-screen celebration overlay with CSS-only confetti animation.
 *
 * - Auto-dismisses after 5 seconds.
 * - Dismissable via button or keyboard (Escape).
 * - Respects `prefers-reduced-motion`: shows a static badge instead of animation.
 * - Does not block pointer events outside the centered card (confetti is pointer-events-none).
 */
export function Celebration({ title, message, onDismiss }: CelebrationProps) {
  const [visible, setVisible] = useState(true);
  const dismissed = useRef(false);

  const dismiss = useCallback(() => {
    if (dismissed.current) return;
    dismissed.current = true;
    setVisible(false);
    onDismiss();
  }, [onDismiss]);

  // Auto-dismiss after AUTO_DISMISS_MS
  useEffect(() => {
    const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [dismiss]);

  // Keyboard dismiss (Escape)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        dismiss();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [dismiss]);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="celebration-overlay pointer-events-none fixed inset-0 z-[9999] flex items-center justify-center"
    >
      {/* Confetti pieces — CSS animation, pointer-events-none so canvas stays usable */}
      <div aria-hidden="true" className="celebration-confetti-container">
        {CONFETTI_PIECES.map((piece) => (
          <div
            key={piece.id}
            className="celebration-piece"
            style={{
              left: `${piece.left}%`,
              animationDelay: `${piece.delay}ms`,
              animationDuration: `${piece.duration}ms`,
              backgroundColor: piece.color,
              width: `${piece.size}px`,
              height: `${piece.size}px`,
              borderRadius: piece.round ? '50%' : '2px',
            }}
          />
        ))}
      </div>

      {/* Centered celebration card — pointer-events-auto so button is clickable */}
      <div className="celebration-card pointer-events-auto relative flex flex-col items-center gap-3 rounded-2xl border border-zinc-700 bg-zinc-900/95 px-8 py-6 text-center shadow-2xl backdrop-blur-sm">
        <button
          onClick={dismiss}
          className="absolute right-3 top-3 rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Dismiss celebration"
        >
          <X size={14} />
        </button>

        <div className="celebration-emoji text-5xl" aria-hidden="true">
          {MILESTONE_EMOJI}
        </div>

        <h2 className="text-xl font-bold text-white">{title}</h2>
        <p className="max-w-xs text-sm text-zinc-400">{message}</p>

        {/* Progress bar showing time until auto-dismiss */}
        <div
          className="celebration-progress mt-1 h-0.5 w-full overflow-hidden rounded-full bg-zinc-700"
          aria-hidden="true"
        >
          <div
            className="celebration-progress-bar h-full rounded-full bg-blue-500"
            style={{ animationDuration: `${AUTO_DISMISS_MS}ms` }}
          />
        </div>
      </div>

      <style>{CELEBRATION_CSS}</style>
    </div>
  );
}

// ---- Confetti data (deterministic — no Math.random() in render) ----

const MILESTONE_EMOJI = '\u2728'; // sparkles

interface ConfettiPiece {
  id: number;
  left: number;
  delay: number;
  duration: number;
  color: string;
  size: number;
  round: boolean;
}

const COLORS = [
  '#3b82f6', // blue-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#f59e0b', // amber-500
  '#10b981', // emerald-500
  '#06b6d4', // cyan-500
  '#f97316', // orange-500
];

// Pre-generated deterministic confetti — no Math.random() in render path
const CONFETTI_PIECES: ConfettiPiece[] = Array.from({ length: 40 }, (_, i) => {
  const left = (i * 37 + 11) % 100;
  const delay = (i * 97) % 800;
  const duration = 1400 + ((i * 113) % 1200);
  const color = COLORS[i % COLORS.length];
  const size = 6 + (i % 3) * 3;
  const round = i % 3 === 0;
  return { id: i, left, delay, duration, color, size, round };
});

// ---- CSS for animation and reduced-motion fallback ----

const CELEBRATION_CSS = `
.celebration-overlay {
  animation: celebration-fade-in 0.3s ease-out;
}

@keyframes celebration-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.celebration-card {
  animation: celebration-card-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes celebration-card-in {
  from { opacity: 0; transform: scale(0.85) translateY(12px); }
  to   { opacity: 1; transform: scale(1)    translateY(0); }
}

.celebration-confetti-container {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.celebration-piece {
  position: absolute;
  top: -16px;
  animation: confetti-fall linear forwards;
}

@keyframes confetti-fall {
  0%   { transform: translateY(-16px) rotate(0deg);   opacity: 1; }
  80%  { opacity: 1; }
  100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
}

.celebration-emoji {
  animation: celebration-pulse 0.6s ease-out;
}

@keyframes celebration-pulse {
  0%   { transform: scale(0.5); }
  60%  { transform: scale(1.2); }
  100% { transform: scale(1); }
}

.celebration-progress-bar {
  animation: progress-drain linear forwards;
  transform-origin: left;
}

@keyframes progress-drain {
  from { transform: scaleX(1); }
  to   { transform: scaleX(0); }
}

/* Reduced motion: disable confetti, keep static card */
@media (prefers-reduced-motion: reduce) {
  .celebration-piece {
    display: none;
  }
  .celebration-overlay,
  .celebration-card,
  .celebration-emoji {
    animation: none;
  }
  .celebration-progress-bar {
    animation: none;
    transform: scaleX(0);
  }
}
`;
