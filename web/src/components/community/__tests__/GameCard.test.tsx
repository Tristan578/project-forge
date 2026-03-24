import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { GameCard } from '../GameCard';

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

  it('renders game title and author', () => {
    render(
      <GameCard game={mockGame} isLiked={false} onLike={vi.fn()} onClick={vi.fn()} />
    );
    expect(screen.getByText('Test Game')).not.toBeNull();
    expect(screen.getByText('by TestAuthor')).not.toBeNull();
  });

  it('renders tags (up to 3)', () => {
    render(
      <GameCard game={mockGame} isLiked={false} onLike={vi.fn()} onClick={vi.fn()} />
    );
    expect(screen.getByText('action')).not.toBeNull();
    expect(screen.getByText('puzzle')).not.toBeNull();
    expect(screen.getByText('platformer')).not.toBeNull();
  });

  it('calls onClick when card is clicked', () => {
    const onClick = vi.fn();
    render(
      <GameCard game={mockGame} isLiked={false} onLike={vi.fn()} onClick={onClick} />
    );
    fireEvent.click(screen.getByText('Test Game'));
    expect(onClick).toHaveBeenCalled();
  });

  it('renders play and like counts', () => {
    render(
      <GameCard game={mockGame} isLiked={false} onLike={vi.fn()} onClick={vi.fn()} />
    );
    expect(screen.getByText('42')).not.toBeNull();
    expect(screen.getByText('10')).not.toBeNull();
  });
});
