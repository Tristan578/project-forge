'use client';

import { useEngineStatus, PHASE_LABELS, type PhaseStatus } from '@/hooks/useEngineStatus';
import { copyInitLogToClipboard } from '@/lib/initLog';
import { useState } from 'react';

const GITHUB_ISSUES_URL = 'https://github.com/Tristan578/project-forge/issues/new';

function PhaseItem({ phase }: { phase: PhaseStatus }) {
  const icon =
    phase.status === 'done'
      ? '\u2713' // checkmark
      : phase.status === 'active'
        ? '\u23F3' // hourglass
        : '\u2022'; // bullet

  const textColor =
    phase.status === 'done'
      ? 'text-green-400'
      : phase.status === 'active'
        ? 'text-blue-400'
        : 'text-zinc-600';

  const timeStr =
    phase.status === 'done' && phase.duration > 0
      ? ` (${(phase.duration / 1000).toFixed(1)}s)`
      : '';

  return (
    <div className={`flex items-center gap-2 text-sm ${textColor}`}>
      <span className="w-4 text-center">{icon}</span>
      <span>
        {phase.message ?? PHASE_LABELS[phase.phase]}
        {timeStr}
      </span>
    </div>
  );
}

function TimeoutWarning({
  phase,
  retryCount,
}: {
  phase: string | null;
  retryCount: number;
}) {
  if (phase === 'wasm_loading') {
    return (
      <div className="mt-4 rounded bg-yellow-900/50 px-3 py-2 text-sm text-yellow-200">
        Slow network? The WASM module is taking longer than expected to download.
      </div>
    );
  }

  if (phase === 'renderer_init') {
    return (
      <div className="mt-4 rounded bg-yellow-900/50 px-3 py-2 text-sm text-yellow-200">
        GPU initialization is taking a while. This may be a compatibility issue.
        {retryCount >= 1 && (
          <div className="mt-1 text-xs text-yellow-300">
            Tip: Try WebGL2 mode on the next retry.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 rounded bg-red-900/50 px-3 py-2 text-sm text-red-200">
      Something went wrong during initialization.
    </div>
  );
}

function FailedState({
  onCopyLog,
  copied,
}: {
  onCopyLog: () => void;
  copied: boolean;
}) {
  return (
    <div className="text-center">
      <div className="mb-4 text-4xl">:(</div>
      <h2 className="mb-2 text-lg font-semibold text-zinc-100">
        Unable to Initialize Engine
      </h2>
      <p className="mb-4 text-sm text-zinc-400">
        We tried 3 times but couldn&apos;t start the engine.
        <br />
        This may be a browser or GPU compatibility issue.
      </p>
      <div className="flex justify-center gap-3">
        <button
          onClick={onCopyLog}
          className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-600"
        >
          {copied ? 'Copied!' : 'Copy Debug Log'}
        </button>
        <a
          href={GITHUB_ISSUES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500"
        >
          Report Issue
        </a>
      </div>
    </div>
  );
}

export function InitOverlay() {
  const {
    phases,
    totalElapsed,
    isTimedOut,
    timeoutPhase,
    retryCount,
    canRetry,
    isReady,
    retry,
    error,
  } = useEngineStatus();

  const [copied, setCopied] = useState(false);

  // Don't render if ready
  if (isReady) {
    return null;
  }

  const handleCopyLog = async () => {
    const success = await copyInitLogToClipboard();
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const showFailedState = retryCount >= 3 || (!canRetry && (isTimedOut || error));

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-zinc-950/95">
      <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
        {showFailedState ? (
          <FailedState onCopyLog={handleCopyLog} copied={copied} />
        ) : (
          <>
            <h2 className="mb-4 text-lg font-semibold text-zinc-100">
              Initializing Engine...
            </h2>

            <div className="space-y-2">
              {phases.map((phase) => (
                <PhaseItem key={phase.phase} phase={phase} />
              ))}
            </div>

            {isTimedOut && (
              <TimeoutWarning phase={timeoutPhase} retryCount={retryCount} />
            )}

            {error && !isTimedOut && (
              <div className="mt-4 rounded bg-red-900/50 px-3 py-2 text-sm text-red-200">
                Error: {error}
              </div>
            )}

            <div className="mt-4 flex items-center justify-between border-t border-zinc-800 pt-4">
              <div className="text-xs text-zinc-500">
                Elapsed: {(totalElapsed / 1000).toFixed(1)}s
                {retryCount > 0 && ` | Attempt ${retryCount + 1}/3`}
              </div>

              {canRetry && isTimedOut && (
                <div className="flex gap-2">
                  <button
                    onClick={retry}
                    className="rounded bg-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-600"
                  >
                    Retry
                  </button>
                  {retryCount >= 1 && (
                    <button
                      onClick={() => {
                        // TODO: Implement WebGL2 fallback mode
                        retry();
                      }}
                      className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500"
                    >
                      Try WebGL2 Mode
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
