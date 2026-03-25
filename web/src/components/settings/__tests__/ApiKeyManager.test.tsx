/**
 * Render tests for ApiKeyManager component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { waitFor } from '@testing-library/react';
import { ApiKeyManager } from '../ApiKeyManager';

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
      expect(screen.getByText('Provider API Keys (BYOK)')).not.toBeNull();
    });
  });

  it('renders MCP API Keys heading', async () => {
    render(<ApiKeyManager />);
    await waitFor(() => {
      expect(screen.getByText('MCP API Keys')).not.toBeNull();
    });
  });

  it('renders all provider labels', async () => {
    render(<ApiKeyManager />);
    await waitFor(() => {
      expect(screen.getByText('Anthropic (Claude)')).not.toBeNull();
      expect(screen.getByText('Meshy')).not.toBeNull();
      expect(screen.getByText('ElevenLabs')).not.toBeNull();
      expect(screen.getByText('Suno')).not.toBeNull();
    });
  });

  it('renders Add Key buttons for unconfigured providers', async () => {
    render(<ApiKeyManager />);
    await waitFor(() => {
      const addKeyButtons = screen.getAllByText('Add Key');
      expect(addKeyButtons.length).toBeGreaterThanOrEqual(5);
    });
  });

  it('shows key input when Add Key clicked', async () => {
    render(<ApiKeyManager />);
    await waitFor(() => {
      const addKeyButtons = screen.getAllByText('Add Key');
      fireEvent.click(addKeyButtons[0]);
    });
    await waitFor(() => {
      expect(screen.getByPlaceholderText('sk-ant-...')).not.toBeNull();
    });
  });

  it('renders Generate API Key button', async () => {
    render(<ApiKeyManager />);
    await waitFor(() => {
      expect(screen.getByText('Generate API Key')).not.toBeNull();
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
      expect(screen.getByText('Configured')).not.toBeNull();
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
      expect(screen.getByText('Key 1')).not.toBeNull();
      expect(screen.getByText('sf_abc...')).not.toBeNull();
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
      expect(screen.getByText('Generate API Key')).not.toBeNull();
    });
    fireEvent.click(screen.getByText('Generate API Key'));
    await waitFor(() => {
      expect(screen.getByText(/error|failed|Server error/i)).not.toBeNull();
    });
  });
});
