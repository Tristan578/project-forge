/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { CapabilitiesAuthSync } from '../CapabilitiesAuthSync';
import { useCapabilities, _resetCapabilitiesCache } from '@/hooks/useFeatureGating';

const auth = vi.hoisted(() => ({ isLoaded: false, userId: undefined as string | null | undefined, sessionId: undefined as string | null | undefined }));
vi.mock('@clerk/nextjs', () => ({ useAuth: () => auth }));
function Consumer() {
  const { available, loading } = useCapabilities();
  return <output>{loading ? 'loading' : available.has('model3d') ? 'available' : 'unavailable'}</output>;
}
const tree = <><CapabilitiesAuthSync /><Consumer /></>;
beforeEach(() => { _resetCapabilitiesCache(); auth.isLoaded = false; auth.userId = undefined; auth.sessionId = undefined; });
afterEach(() => { cleanup(); _resetCapabilitiesCache(); vi.restoreAllMocks(); });
it('refreshes mounted consumers on sign-in, account switch, and sign-out', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
    capabilities: [{ capability: 'model3d', available: auth.userId === 'user-a', label: 'Model' }],
    available: auth.userId === 'user-a' ? ['model3d'] : [],
    unavailable: auth.userId === 'user-a' ? [] : ['model3d'],
  }), { status: 200 }));
  const view = render(tree);
  await waitFor(() => expect(view.getByText('unavailable')).toBeInTheDocument());
  auth.isLoaded = true; auth.userId = 'user-a'; auth.sessionId = 'session-a';
  view.rerender(<><CapabilitiesAuthSync /><Consumer /></>);
  await waitFor(() => expect(view.getByText('available')).toBeInTheDocument());
  auth.userId = 'user-b'; auth.sessionId = 'session-b';
  view.rerender(<><CapabilitiesAuthSync /><Consumer /></>);
  await waitFor(() => expect(view.getByText('unavailable')).toBeInTheDocument());
  auth.userId = null; auth.sessionId = null;
  view.rerender(<><CapabilitiesAuthSync /><Consumer /></>);
  await waitFor(() => expect(view.getByText('unavailable')).toBeInTheDocument());
  expect(fetch).toHaveBeenCalledTimes(4);
});
