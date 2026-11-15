/** Native gallery action isolation and keyboard activation regressions. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { GameCard } from '../GameCard';
import userEvent from '@testing-library/user-event';

vi.mock('lucide-react', () => ({
  Heart: (props: Record<string, unknown>) => <span data-testid="heart-icon" {...props} />,
  Play: (props: Record<string, unknown>) => <span data-testid="play-icon" {...props} />,
  Star: (props: Record<string, unknown>) => <span data-testid="star-icon" {...props} />,
}));

vi.mock('../StarRating', () => ({
  StarRating: ({ value }: { value: number }) => (
    <span data-testid="star-rating">{value}</span>
  ),
}));

const mockGame = {
  id: 'game-1',
  title: 'Test Game',
  description: 'A test game',
  slug: 'test-game',
  authorName: 'TestAuthor',
  authorId: 'author-1',
  playCount: 42,
  likeCount: 10,
  avgRating: 4.5,
  ratingCount: 8,
  commentCount: 3,
  tags: ['action', 'puzzle', 'platformer'],
  thumbnail: null,
  cdnUrl: null,
  createdAt: '2024-01-01',
};

describe('GameCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('uses independent native View and Like controls without semantic nesting', () => {
    render(<GameCard game={mockGame} isLiked={false} onLike={vi.fn()} onClick={vi.fn()} />);
    const view = screen.getByRole('button', { name: 'View Test Game' });
    const like = screen.getByRole('button', { name: 'Like' });
    expect(view.tagName).toBe('BUTTON');
    expect(view).not.toContainElement(like);
  });

  it('renders game title and author', () => {
    render(
      <GameCard game={mockGame} isLiked={false} onLike={vi.fn()} onClick={vi.fn()} />
    );
    expect(screen.getByText('Test Game')).toBeDefined();
    expect(screen.getByText('by TestAuthor')).toBeDefined();
  });

  it('renders tags (up to 3)', () => {
    render(
      <GameCard game={mockGame} isLiked={false} onLike={vi.fn()} onClick={vi.fn()} />
    );
    expect(screen.getByText('action')).toBeDefined();
    expect(screen.getByText('puzzle')).toBeDefined();
    expect(screen.getByText('platformer')).toBeDefined();
  });

  it('calls onClick when card is clicked', () => {
    const onClick = vi.fn();
    render(
      <GameCard game={mockGame} isLiked={false} onLike={vi.fn()} onClick={onClick} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'View Test Game' }));
    expect(onClick).toHaveBeenCalled();
  });

  it('renders play and like counts', () => {
    render(
      <GameCard game={mockGame} isLiked={false} onLike={vi.fn()} onClick={vi.fn()} />
    );
    expect(screen.getByText('42')).toBeDefined();
    expect(screen.getByText('10')).toBeDefined();
  });

  // a11y (#9048): the card must be a real, keyboard-operable control.
  it('reaches View and then Like through normal Tab order', async () => {
    render(<GameCard game={mockGame} isLiked={false} onLike={vi.fn()} onClick={vi.fn()} />);
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('button', { name: 'View Test Game' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Like' })).toHaveFocus();
  });

  it.each(['{Enter}', ' '])('activates View once with native %s keyboard behavior', async key => {
    const onClick = vi.fn();
    render(<GameCard game={mockGame} isLiked={false} onLike={vi.fn()} onClick={onClick} />);
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard(key);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('activates Like with Enter without opening details', async () => {
    const onClick = vi.fn();
    const onLike = vi.fn();
    render(<GameCard game={mockGame} isLiked={false} onLike={onLike} onClick={onClick} />);
    const user = userEvent.setup();
    await user.tab();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onLike).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('gives the like button an accessible name and aria-pressed reflecting state', () => {
    const { rerender } = render(
      <GameCard game={mockGame} isLiked={false} onLike={vi.fn()} onClick={vi.fn()} />
    );
    const likeButton = screen.getByRole('button', { name: 'Like' });
    expect(likeButton.getAttribute('aria-pressed')).toBe('false');

    rerender(
      <GameCard game={mockGame} isLiked={true} onLike={vi.fn()} onClick={vi.fn()} />
    );
    const pressed = screen.getByRole('button', { name: 'Unlike' });
    expect(pressed.getAttribute('aria-pressed')).toBe('true');
  });

  it('does not fire onClick for the card when the like button is clicked', () => {
    const onClick = vi.fn();
    const onLike = vi.fn();
    render(
      <GameCard game={mockGame} isLiked={false} onLike={onLike} onClick={onClick} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    expect(onLike).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
