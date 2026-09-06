/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiKeyManager } from '../ApiKeyManager';
import { _resetCapabilitiesCache, useCapabilities } from '@/hooks/useFeatureGating';

function Availability() {
  const { available, loading } = useCapabilities();
  return <output data-testid="availability">{loading ? 'loading' : available.has('model3d') ? 'enabled' : 'disabled'}</output>;
}

describe('BYOK capabilities refresh (#9725)', () => {
  beforeEach(() => _resetCapabilitiesCache());
  afterEach(() => { cleanup(); _resetCapabilitiesCache(); vi.restoreAllMocks(); });

  it.each([true, false])('updates mounted availability only after a successful key removal (success=%s)', async (success) => {
    let configured = true;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (url === '/api/keys/meshy') {
        if (success) configured = false;
        return new Response('{}', { status: success ? 200 : 500 });
      }
      if (url === '/api/capabilities') return new Response(JSON.stringify({
        capabilities: [{ capability: 'model3d', available: configured, label: 'Model' }],
        available: configured ? ['model3d'] : [], unavailable: configured ? [] : ['model3d'],
      }));
      if (url === '/api/keys' && !init) return new Response(JSON.stringify({
        providers: [{ provider: 'meshy', configured: true, createdAt: '2026-01-01' }],
      }));
      return new Response('{"keys":[]}');
    });
    render(<><ApiKeyManager /><Availability /></>);
    await waitFor(() => expect(screen.getByTestId('availability')).toHaveTextContent('enabled'));
    fireEvent.click(await screen.findByLabelText('Remove Meshy API key'));
    if (success) {
      await waitFor(() => expect(screen.getByTestId('availability')).toHaveTextContent('disabled'));
      expect(screen.queryByLabelText('Remove Meshy API key')).not.toBeInTheDocument();
    } else {
      await screen.findByRole('alert');
      expect(screen.getByTestId('availability')).toHaveTextContent('enabled');
      expect(screen.getByLabelText('Remove Meshy API key')).toBeInTheDocument();
    }
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/capabilities')).toHaveLength(success ? 2 : 1);
  });

  it('enables a mounted capability consumer after saving a Meshy key', async () => {
    let configured = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (url === '/api/keys/meshy' && init?.method === 'PUT') configured = true;
      if (url === '/api/capabilities') return new Response(JSON.stringify({
        capabilities: [{ capability: 'model3d', available: configured, label: 'Model' }],
        available: configured ? ['model3d'] : [], unavailable: configured ? [] : ['model3d'],
      }));
      return new Response('{"providers":[],"keys":[]}');
    });
    render(<><ApiKeyManager /><Availability /></>);
    await waitFor(() => expect(screen.getByTestId('availability')).toHaveTextContent('disabled'));
    const row = screen.getByText('Meshy').parentElement!;
    fireEvent.click(within(row).getByText('Add Key'));
    fireEvent.change(screen.getByLabelText('Meshy API key'), { target: { value: 'test-key' } });
    fireEvent.click(within(row).getByText('Save'));
    await waitFor(() => expect(screen.getByTestId('availability')).toHaveTextContent('enabled'));
  });
});
