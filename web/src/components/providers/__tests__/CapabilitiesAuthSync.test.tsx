/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { CapabilitiesAuthSync } from '../CapabilitiesAuthSync';
import { useCapabilities, _resetCapabilitiesCache } from '@/hooks/useFeatureGating';

/** What Clerk's client-side hook reports (hydration state). */
const auth = vi.hoisted(() => ({
  isLoaded: false,
  userId: undefined as string | null | undefined,
  sessionId: undefined as string | null | undefined,
}));
vi.mock('@clerk/nextjs', () => ({ useAuth: () => auth }));

/**
 * What the SERVER sees. The browser attaches the Clerk session cookie to the
 * very first `/api/capabilities` request, so the route already knows who is
 * calling before `useAuth()` finishes hydrating — which is exactly why the
 * `isLoaded` transition is not a reason to refetch.
 */
const session = vi.hoisted(() => ({ userId: null as string | null }));

function Consumer() {
  const { available, loading } = useCapabilities();
  return <output>{loading ? 'loading' : available.has('model3d') ? 'available' : 'unavailable'}</output>;
}
const tree = <><CapabilitiesAuthSync /><Consumer /></>;
const rerender = (view: ReturnType<typeof render>) =>
  view.rerender(<><CapabilitiesAuthSync /><Consumer /></>);

function mockFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
    capabilities: [{ capability: 'model3d', available: session.userId === 'user-a', label: 'Model' }],
    available: session.userId === 'user-a' ? ['model3d'] : [],
    unavailable: session.userId === 'user-a' ? [] : ['model3d'],
    degraded: false,
  }), { status: 200 }));
}

describe('CapabilitiesAuthSync', () => {
  beforeEach(() => {
    _resetCapabilitiesCache();
    auth.isLoaded = false;
    auth.userId = undefined;
    auth.sessionId = undefined;
    session.userId = null;
  });
  afterEach(() => { cleanup(); _resetCapabilitiesCache(); vi.restoreAllMocks(); });

  // Clerk reports isLoaded false -> true with userId undefined -> null|id on
  // EVERY page load under ClerkProvider. Invalidating on that transition threw
  // away the first (already cookie-authenticated, already correct) response and
  // issued a second no-store request on every editor page load, anonymous
  // included — doubling the load this route was just given headroom for, and
  // briefly flipping consumers back to loading in between (#9725 p7).
  it('costs exactly one request on a page load, signed in', async () => {
    session.userId = 'user-a';
    const fetchSpy = mockFetch();
    const view = render(tree);
    await waitFor(() => expect(view.getByText('available')).toBeInTheDocument());

    auth.isLoaded = true; auth.userId = 'user-a'; auth.sessionId = 'session-a';
    rerender(view);
    await waitFor(() => expect(view.getByText('available')).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('costs exactly one request on a page load, anonymous', async () => {
    const fetchSpy = mockFetch();
    const view = render(tree);
    await waitFor(() => expect(view.getByText('unavailable')).toBeInTheDocument());

    auth.isLoaded = true; auth.userId = null; auth.sessionId = null;
    rerender(view);
    await waitFor(() => expect(view.getByText('unavailable')).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('refreshes mounted consumers on account switch and sign-out', async () => {
    session.userId = 'user-a';
    auth.isLoaded = true; auth.userId = 'user-a'; auth.sessionId = 'session-a';
    const fetchSpy = mockFetch();
    const view = render(tree);
    await waitFor(() => expect(view.getByText('available')).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    session.userId = 'user-b';
    auth.userId = 'user-b'; auth.sessionId = 'session-b';
    rerender(view);
    await waitFor(() => expect(view.getByText('unavailable')).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    session.userId = 'user-a';
    auth.userId = 'user-a'; auth.sessionId = 'session-a';
    rerender(view);
    await waitFor(() => expect(view.getByText('available')).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    session.userId = null;
    auth.userId = null; auth.sessionId = null;
    rerender(view);
    await waitFor(() => expect(view.getByText('unavailable')).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });
});
