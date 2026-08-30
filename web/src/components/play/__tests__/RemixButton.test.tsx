/**
 * Tests for RemixButton component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@/test/utils/componentTestUtils';
import { RemixButton } from '../RemixButton';

const pushMock = vi.fn();

vi.mock('lucide-react', () => ({
  GitFork: (props: Record<string, unknown>) => <span data-testid="fork-icon" {...props} />,
  Loader2: (props: Record<string, unknown>) => <span data-testid="loader-icon" {...props} />,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

describe('RemixButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows "Sign up to remix" when not authenticated', () => {
    render(<RemixButton userId="user-1" slug="my-game" isAuthenticated={false} />);
    expect(screen.getByText('Sign up to remix')).toBeDefined();
  });

  it('shows "Remix" when authenticated', () => {
    render(<RemixButton userId="user-1" slug="my-game" isAuthenticated={true} />);
    expect(screen.getByText('Remix')).toBeDefined();
  });

  it('links to sign-in when not authenticated', () => {
    render(<RemixButton userId="user-1" slug="my-game" isAuthenticated={false} />);
    const link = screen.getByText('Sign up to remix').closest('a');
    expect(link?.getAttribute('href')).toContain('/sign-in');
  });

  it('calls remix API when clicked (authenticated)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ projectId: 'new-proj-id', name: 'Game (Remix)', quarantinedScripts: 2 }),
    });

    render(<RemixButton userId="user-1" slug="my-game" isAuthenticated={true} />);
    const button = screen.getByText('Remix');
    fireEvent.click(button);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/play/user-1/my-game/remix',
        expect.objectContaining({ method: 'POST' })
      );
      expect(pushMock).toHaveBeenCalledWith('/editor/new-proj-id?quarantinedScripts=2');
    });
  });

  it('does not add a quarantine notice when no scripts were disabled', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ projectId: 'new-proj-id', name: 'Game (Remix)', quarantinedScripts: 0 }),
    });

    render(<RemixButton userId="user-1" slug="my-game" isAuthenticated={true} />);
    fireEvent.click(screen.getByText('Remix'));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/editor/new-proj-id');
    });
  });

  it('shows error message on failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Project limit reached' }),
    });

    render(<RemixButton userId="user-1" slug="my-game" isAuthenticated={true} />);
    fireEvent.click(screen.getByText('Remix'));

    await waitFor(() => {
      expect(screen.getByText('Project limit reached')).toBeDefined();
    });
  });
});
