/**
 * The analytics page's own guard (#8352): signed-out requests are sent to
 * sign-in before anything renders; signed-in ones get the panel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const safeAuth = vi.fn();
vi.mock('@/lib/auth/safe-auth', () => ({ safeAuth: () => safeAuth() }));

class RedirectSignal extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));

vi.mock('@/components/dashboard/CreatorAnalyticsPanel', () => ({
  CreatorAnalyticsPanel: function CreatorAnalyticsPanel() {
    return null;
  },
}));

import CreatorAnalyticsPage from '../page';
import { CreatorAnalyticsPanel } from '@/components/dashboard/CreatorAnalyticsPanel';

beforeEach(() => {
  safeAuth.mockReset();
});

describe('/dashboard/analytics', () => {
  it('redirects a signed-out request to sign-in', async () => {
    safeAuth.mockResolvedValue({ userId: null });

    await expect(CreatorAnalyticsPage()).rejects.toMatchObject({ to: '/sign-in' });
  });

  it('renders the analytics panel for a signed-in creator', async () => {
    safeAuth.mockResolvedValue({ userId: 'user_123' });

    const element = await CreatorAnalyticsPage();

    expect(element.type).toBe(CreatorAnalyticsPanel);
  });
});
