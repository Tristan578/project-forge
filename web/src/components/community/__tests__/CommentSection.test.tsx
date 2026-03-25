import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { CommentSection } from '../CommentSection';

vi.mock('lucide-react', () => ({
  MessageCircle: (props: Record<string, unknown>) => <span data-testid="message-circle" {...props} />,
  Flag: (props: Record<string, unknown>) => <span data-testid="flag-icon" {...props} />,
}));

const mockComments = [
  {
    id: 'c-1',
    content: 'Great game!',
    parentId: null,
    authorId: 'a-1',
    authorName: 'Alice',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'c-2',
    content: 'Thanks!',
    parentId: 'c-1',
    authorId: 'a-2',
    authorName: 'Bob',
    createdAt: new Date().toISOString(),
  },
];

describe('CommentSection', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    render(
      <CommentSection
        comments={mockComments}
        gameId="game-1"
        onAddComment={vi.fn()}
      />
    );
    expect(screen.getByText(`Comments (${mockComments.length})`)).not.toBeNull();
  });

  it('renders top-level comments and replies', () => {
    render(
      <CommentSection
        comments={mockComments}
        gameId="game-1"
        onAddComment={vi.fn()}
      />
    );
    expect(screen.getByText('Great game!')).not.toBeNull();
    expect(screen.getByText('Alice')).not.toBeNull();
    expect(screen.getByText('Thanks!')).not.toBeNull();
    expect(screen.getByText('Bob')).not.toBeNull();
  });

  it('shows empty state when no comments', () => {
    render(
      <CommentSection
        comments={[]}
        gameId="game-1"
        onAddComment={vi.fn()}
      />
    );
    expect(screen.getByText('No comments yet. Be the first to comment!')).not.toBeNull();
  });

  it('submits a new comment', () => {
    const onAddComment = vi.fn();
    render(
      <CommentSection
        comments={[]}
        gameId="game-1"
        onAddComment={onAddComment}
      />
    );
    const textarea = screen.getByPlaceholderText('Add a comment...');
    fireEvent.change(textarea, { target: { value: 'My comment' } });
    fireEvent.click(screen.getByText('Post'));
    expect(onAddComment).toHaveBeenCalledWith('My comment', undefined);
  });
});
