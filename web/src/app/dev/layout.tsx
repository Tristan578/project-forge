import { redirect } from 'next/navigation';
import { e2eHooksEnabled } from '@/lib/e2e/testHooks';
import { ViewportLock } from '@/components/layout/ViewportLock';

export default function DevLayout({ children }: { children: React.ReactNode }) {
  // The /dev auth-bypass editor renders in local development AND in the strict
  // interactive-journey CI build (NEXT_PUBLIC_E2E_HOOKS=true), which drives the
  // real editor on a production `next start` server. A normal production deploy
  // never sets that flag, so /dev still redirects to sign-in there.
  if (!e2eHooksEnabled()) {
    redirect('/sign-in');
  }
  // /dev renders the same EditorLayout as /editor/[id], so it needs the same
  // full-viewport scroll lock.
  return <ViewportLock>{children}</ViewportLock>;
}
