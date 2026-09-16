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
    expect(screen.getByText('(12)')).toBeDefined();
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

  // a11y (#9048)
  it('names each interactive star button', () => {
    render(<StarRating value={2} interactive onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Rate 1 star' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Rate 3 stars' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Rate 5 stars' })).toBeDefined();
  });

  it('groups interactive stars in a labelled radiogroup', () => {
    render(<StarRating value={2} interactive onChange={vi.fn()} />);
    expect(screen.getByRole('radiogroup', { name: 'Rate this game' })).toBeDefined();
  });

  it('reflects the selected rating with aria-pressed on interactive stars', () => {
    render(<StarRating value={3} interactive onChange={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Rate 2 stars' }).getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Rate 4 stars' }).getAttribute('aria-pressed')
    ).toBe('false');
  });

  it('announces non-interactive stars as a single labelled image', () => {
    render(<StarRating value={4.5} count={12} />);
    const img = screen.getByRole('img', {
      name: 'Average rating: 4.5 out of 5 stars, 12 ratings',
    });
    expect(img).toBeDefined();
  });

  it('omits the rating count from the label when not provided', () => {
    render(<StarRating value={3} />);
    expect(
      screen.getByRole('img', { name: 'Average rating: 3 out of 5 stars' })
    ).toBeDefined();
  });
});
