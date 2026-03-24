import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { StarRating } from '../StarRating';

vi.mock('lucide-react', () => ({
  Star: (props: Record<string, unknown>) => <span data-testid="star-icon" {...props} />,
}));

describe('StarRating', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders 5 star buttons', () => {
    render(<StarRating value={3} />);
    const stars = screen.getAllByRole('button');
    expect(stars).toHaveLength(5);
  });

  it('displays count when provided', () => {
    render(<StarRating value={4.5} count={12} />);
    expect(screen.getByText('(12)')).not.toBeNull();
  });

  it('does not display count when not provided', () => {
    render(<StarRating value={3} />);
    expect(screen.queryByText(/\(\d+\)/)).toBeNull();
  });

  it('calls onChange when interactive and a star is clicked', () => {
    const onChange = vi.fn();
    render(<StarRating value={2} interactive onChange={onChange} />);
    const stars = screen.getAllByRole('button');
    fireEvent.click(stars[3]); // Click 4th star
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('disables stars when not interactive', () => {
    render(<StarRating value={3} />);
    const stars = screen.getAllByRole('button');
    expect(stars[0].hasAttribute('disabled')).toBe(true);
  });
});
