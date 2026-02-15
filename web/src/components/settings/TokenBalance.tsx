'use client';

import { useEffect } from 'react';
import { useUserStore } from '@/stores/userStore';
import { useUser } from '@clerk/nextjs';
import { Coins } from 'lucide-react';

/** Compact token balance display for the editor header */
export function TokenBalance() {
  const { isSignedIn } = useUser();
  const { tier, tokenBalance, fetchBalance } = useUserStore();

  useEffect(() => {
    if (isSignedIn) {
      fetchBalance();
    }
  }, [isSignedIn, fetchBalance]);

  if (!isSignedIn) return null;
  if (tier === 'starter') return null;

  const total = tokenBalance?.total ?? 0;

  return (
    <div className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-2 py-1 text-xs">
      <Coins size={14} className="text-yellow-400" />
      <span className="font-mono text-zinc-200">
        {total.toLocaleString()}
      </span>
    </div>
  );
}
