'use client';

import { useEffect } from 'react';
import { useUserStore } from '@/stores/userStore';
import { useUser } from '@clerk/nextjs';
import { Coins } from 'lucide-react';

// Clerk validates key format — hooks throw without ClerkProvider (CI E2E)
const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
const hasClerk = clerkKey.startsWith('pk_test_') || clerkKey.startsWith('pk_live_');

/** Compact token balance display for the editor header */
export function TokenBalance() {
  if (!hasClerk) return null;
  return <TokenBalanceInner />;
}

function TokenBalanceInner() {
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
