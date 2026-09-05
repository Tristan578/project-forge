/**
 * Render tests for ApiKeyManager component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { waitFor } from '@testing-library/react';
import { ApiKeyManager } from '../ApiKeyManager';

// A BYOK change must drop the per-user capabilities cache at once (#9725).
vi.mock('@/hooks/useFeatureGating', () => ({ invalidateCapabilitiesCache: vi.fn() }));
import { invalidateCapabilitiesCache } from '@/hooks/useFeatureGating';

vi.mock('lucide-react', () => ({
  Key: (props: Record<string, unknown>) => <span data-testid="key-icon" {...props} />,
  Plus: (props: Record<string, unknown>) => <span data-testid="plus-icon" {...props} />,
  Trash2: (props: Record<string, unknown>) => <span data-testid="trash-icon" {...props} />,
  Copy: (props: Record<string, unknown>) => <span data-testid="copy-icon" {...props} />,
  Check: (props: Record<string, unknown>) => <span data-testid="check-icon" {...props} />,
}));

describe('ApiKeyManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no configured keys
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/keys') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ providers: [] }) });
      }
      if (url === '/api/keys/api-key') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ keys: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Provider API Keys heading', async () => {
    render(<ApiKeyManager />);
    await waitFor(() => {
      expect(screen.getByText('Provider API Keys (BYOK)')).toBeDefined();
    });
  });

  it('renders MCP API Keys heading', async () => {
    render(<ApiKeyManager />);
    await waitFor(() => {
      expect(screen.getByText('MCP API Keys')).toBeDefined();
    });
  });

  it('renders all provider labels', async () => {
    render(<ApiKeyManager />);
    await waitFor(() => {
      expect(screen.getByText('Anthropic (Claude)')).toBeDefined();
      expect(screen.getByText('Meshy')).toBeDefined();
      expect(screen.getByText('ElevenLabs')).toBeDefined();
      // Suno is deliberately absent: no public API, `music` refused regardless (#9522).
      expect(screen.queryByText('Suno')).toBeNull();
    });
  });

  it('renders Add Key buttons for unconfigured providers', async () => {
    render(<ApiKeyManager />);
    await waitFor(() => {
      const addKeyButtons = screen.getAllByText('Add Key');
      expect(addKeyButtons.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('shows key input when Add Key clicked', async () => {
    render(<ApiKeyManager />);
    await waitFor(() => {
      const addKeyButtons = screen.getAllByText('Add Key');
      fireEvent.click(addKeyButtons[0]);
    });
    await waitFor(() => {
      expect(screen.getByPlaceholderText('sk-ant-...')).toBeDefined();
    });
  });

  it('renders Generate API Key button', async () => {
    render(<ApiKeyManager />);
    await waitFor(() => {
      expect(screen.getByText('Generate API Key')).toBeDefined();
    });
  });

  it('shows Configured label for configured provider', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/keys') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            providers: [{ provider: 'anthropic', configured: true, createdAt: '2024-01-01' }],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ keys: [] }) });
    });
    render(<ApiKeyManager />);
    await waitFor(() => {
      expect(screen.getByText('Configured')).toBeDefined();
    });
  });

  it('renders existing MCP keys', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/keys') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ providers: [] }) });
      }
      if (url === '/api/keys/api-key') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            keys: [{ id: 'key-1', name: 'Key 1', prefix: 'sf_abc', scopes: ['read'], lastUsed: null, createdAt: '2024-01-01' }],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    render(<ApiKeyManager />);
    await waitFor(() => {
      expect(screen.getByText('Key 1')).toBeDefined();
      expect(screen.getByText('sf_abc...')).toBeDefined();
    });
  });

  it('shows error banner when generate key fails', async () => {
    // Initial load succeeds, but POST to generate a key fails
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url === '/api/keys') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ providers: [] }) });
      }
      if (url === '/api/keys/api-key' && (!opts || opts.method !== 'POST')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ keys: [] }) });
      }
      if (url === '/api/keys/api-key' && opts?.method === 'POST') {
        return Promise.resolve({ ok: false, text: () => Promise.resolve('Server error') });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    render(<ApiKeyManager />);
    await waitFor(() => {
      expect(screen.getByText('Generate API Key')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Generate API Key'));
    await waitFor(() => {
      expect(screen.getByText(/error|failed|Server error/i)).toBeDefined();
    });
  });
});

describe('ApiKeyManager retired-provider keys (#9117 / #9522)', () => {
  // The invalidateCapabilitiesCache mock is module-scoped; its call count
  // must not leak from one test into the next.
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('shows a remove-only row for a stored Suno key and issues DELETE on removal', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/keys' && !init) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ providers: [{ provider: 'suno', configured: true, createdAt: '2026-01-01T00:00:00Z' }] }),
        });
      }
      if (url === '/api/keys/api-key') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ keys: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    global.fetch = fetchMock;
    render(<ApiKeyManager />);
    await waitFor(() => {
      expect(screen.getByText('(no longer offered)')).toBeDefined();
    });
    // Human label, not the raw id; no Add-Key affordance for it.
    expect(screen.getByText(/^Suno/)).toBeDefined();
    expect(screen.queryByLabelText('Suno API key')).toBeNull();
    fireEvent.click(screen.getByLabelText('Remove Suno API key'));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/keys/suno', { method: 'DELETE' });
      expect(screen.queryByText('(no longer offered)')).toBeNull();
    });
    expect(vi.mocked(invalidateCapabilitiesCache)).toHaveBeenCalled();
  });

  // DELETE /api/keys/[provider] answers 403 (stale step-up), 429 or 500 with a
  // resolved fetch. Removing the row on a non-ok response left the key in
  // place server-side with nothing on screen, back on the next reload — and
  // invalidated the capabilities cache as if the key were gone.
  it('keeps the row, shows the error and leaves the cache alone when DELETE is refused', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/keys' && !init) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ providers: [{ provider: 'suno', configured: true, createdAt: '2026-01-01T00:00:00Z' }] }),
        });
      }
      if (url === '/api/keys/api-key') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ keys: [] }) });
      }
      if (url === '/api/keys/suno' && init?.method === 'DELETE') {
        return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: 'reverify' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    global.fetch = fetchMock;
    render(<ApiKeyManager />);
    await waitFor(() => {
      expect(screen.getByText('(no longer offered)')).toBeDefined();
    });
    fireEvent.click(screen.getByLabelText('Remove Suno API key'));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/keys/suno', { method: 'DELETE' });
      expect(screen.getByRole('alert').textContent).toMatch(/Failed to remove suno key/);
    });
    expect(screen.getByText('(no longer offered)')).toBeDefined();
    expect(vi.mocked(invalidateCapabilitiesCache)).not.toHaveBeenCalled();
  });

  // Same guard on the MCP key list: revoking is a DELETE that can be refused.
  it('keeps an MCP key row and shows the error when its DELETE is refused', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/keys') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ providers: [] }) });
      }
      if (url === '/api/keys/api-key' && !init) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            keys: [{ id: 'key-1', name: 'Key 1', prefix: 'sf_abc', scopes: ['read'], lastUsed: null, createdAt: '2024-01-01' }],
          }),
        });
      }
      if (url === '/api/keys/api-key/key-1' && init?.method === 'DELETE') {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    render(<ApiKeyManager />);
    await waitFor(() => {
      expect(screen.getByText('Key 1')).toBeDefined();
    });
    fireEvent.click(screen.getByLabelText('Revoke key Key 1'));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/Failed to revoke key/);
    });
    expect(screen.getByText('Key 1')).toBeDefined();
  });
});
