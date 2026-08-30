'use client';

import { useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';

export function RemixQuarantineNotice({ count }: { count: number }) {
  const [dismissed, setDismissed] = useState(false);

  if (!Number.isSafeInteger(count) || count <= 0 || dismissed) return null;

  return (
    <div
      role="status"
      className="fixed top-3 left-1/2 z-[100] flex max-w-xl -translate-x-1/2 items-start gap-3 rounded-lg border border-amber-500/40 bg-zinc-900 px-4 py-3 text-sm text-zinc-200 shadow-xl"
    >
      <ShieldAlert className="mt-0.5 shrink-0 text-amber-400" size={18} aria-hidden="true" />
      <p>
        {count} {count === 1 ? 'script was' : 'scripts were'} disabled for your safety when this game was remixed.
        Review the source in the Script panel, then enable each script you trust.
      </p>
      <button
        type="button"
        aria-label="Dismiss disabled scripts notice"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
