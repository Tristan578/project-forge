/**
 * Render tests for GamePlayer component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { waitFor } from '@testing-library/react';
import { GamePlayer } from '../GamePlayer';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('lucide-react', () => ({
  ArrowLeft: (props: Record<string, unknown>) => <span data-testid="arrow-left" {...props} />,
  Maximize: (props: Record<string, unknown>) => <span data-testid="maximize-icon" {...props} />,
  Minimize: (props: Record<string, unknown>) => <span data-testid="minimize-icon" {...props} />,
  Loader2: (props: Record<string, unknown>) => <span data-testid="loader-icon" {...props} />,
  Share2: (props: Record<string, unknown>) => <span data-testid="share-icon" {...props} />,
  Twitter: (props: Record<string, unknown>) => <span data-testid="twitter-icon" {...props} />,
  MessageCircle: (props: Record<string, unknown>) => <span data-testid="discord-icon" {...props} />,
  GitFork: (props: Record<string, unknown>) => <span data-testid="fork-icon" {...props} />,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const mockGame = {
  id: 'game-1',
  title: 'My Awesome Game',
  description: 'A cool game',
  slug: 'my-awesome-game',
  version: 1,
  creatorName: 'Alice',
  sceneData: {},
};

describe('GamePlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows loading spinner initially', () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {})); // never resolves
    render(<GamePlayer userId="user-1" slug="my-awesome-game" />);
    expect(screen.getByText('Loading game...')).toBeDefined();
  });

  it('shows loader icon while loading', () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    render(<GamePlayer userId="user-1" slug="my-awesome-game" />);
    expect(screen.getByTestId('loader-icon')).toBeDefined();
  });

  it('renders game title after successful fetch', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ game: mockGame }),
    });
    render(<GamePlayer userId="user-1" slug="my-awesome-game" />);
    await waitFor(() => {
      expect(screen.getByText('My Awesome Game')).toBeDefined();
    });
  });

  it('renders creator name after successful fetch', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ game: mockGame }),
    });
    render(<GamePlayer userId="user-1" slug="my-awesome-game" />);
    await waitFor(() => {
      expect(screen.getByText('by Alice')).toBeDefined();
    });
  });

  it('shows Click to play after successful fetch', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ game: mockGame }),
    });
    render(<GamePlayer userId="user-1" slug="my-awesome-game" />);
    await waitFor(() => {
      expect(screen.getByText('Click to play')).toBeDefined();
    });
  });

  it('shows Game Not Found when fetch returns 404', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Game not found' }),
    });
    render(<GamePlayer userId="user-1" slug="nonexistent" />);
    await waitFor(() => {
      expect(screen.getByText('Game Not Found')).toBeDefined();
    });
  });

  it('shows error message on failed fetch', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Game not found' }),
    });
    render(<GamePlayer userId="user-1" slug="nonexistent" />);
    await waitFor(() => {
      expect(screen.getByText('Game not found')).toBeDefined();
    });
  });

  it('shows Back to SpawnForge link on error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Game not found' }),
    });
    render(<GamePlayer userId="user-1" slug="nonexistent" />);
    await waitFor(() => {
      expect(screen.getByText('Back to SpawnForge')).toBeDefined();
    });
  });

  it('shows Something Went Wrong for non-404 errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Internal server error' }),
    });
    render(<GamePlayer userId="user-1" slug="some-game" />);
    await waitFor(() => {
      expect(screen.getByText('Something Went Wrong')).toBeDefined();
    });
  });

  it('shows network error message on fetch exception', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));
    render(<GamePlayer userId="user-1" slug="some-game" />);
    await waitFor(() => {
      expect(screen.getByText('Network error -- could not load game')).toBeDefined();
    });
  });

  it('renders fullscreen button after game loads', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ game: mockGame }),
    });
    render(<GamePlayer userId="user-1" slug="my-awesome-game" />);
    await waitFor(() => {
      expect(screen.getByTestId('maximize-icon')).toBeDefined();
    });
  });
});
