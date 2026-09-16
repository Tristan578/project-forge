/** Native rating selection, independent groups, and read-only announcements. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { StarRating } from '../StarRating';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';

vi.mock('lucide-react', () => ({
  Star: (props: Record<string, unknown>) => <span data-testid="star-icon" {...props} />,
}));

describe('StarRating', () => {
  afterEach(() => {
    cleanup();
  });

  it('uses exactly one selected radio and changes selection with arrow keys', async () => {
    const changed = vi.fn();
    function ControlledRating() {
      const [value, setValue] = useState(3);
      return <StarRating value={value} interactive onChange={next => { changed(next); setValue(next); }} />;
    }
    render(<ControlledRating />);
    const user = userEvent.setup();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
    expect(radios.filter(radio => (radio as HTMLInputElement).checked)).toEqual([radios[2]]);
    await user.tab();
    expect(radios[2]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(radios[3]).toHaveFocus();
    expect(radios[3]).toBeChecked();
    expect(radios[2]).not.toBeChecked();
    expect(changed).toHaveBeenCalledExactlyOnceWith(4);
  });

  it('renders five decorative stars without controls for a read-only average', () => {
    render(<StarRating value={3} />);
    expect(screen.getAllByTestId('star-icon')).toHaveLength(5);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('keeps multiple native rating groups independent and unselected zero navigable', async () => {
    const firstChanged = vi.fn();
    const secondChanged = vi.fn();
    render(<><StarRating value={0} interactive onChange={firstChanged} />
      <StarRating value={2} interactive onChange={secondChanged} /></>);
    const groups = screen.getAllByRole('radiogroup');
    const first = groups[0].querySelectorAll<HTMLInputElement>('input');
    const second = groups[1].querySelectorAll<HTMLInputElement>('input');
    expect(first[0].name).not.toBe(second[0].name);
    expect([...first].some(input => input.checked)).toBe(false);
    expect(second[1]).toBeChecked();
    const user = userEvent.setup();
    await user.tab();
    expect(first[0]).toHaveFocus();
    await user.keyboard(' ');
    expect(firstChanged).toHaveBeenCalledExactlyOnceWith(1);
    expect(secondChanged).not.toHaveBeenCalled();
    expect(second[1]).toBeChecked();
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
    const stars = screen.getAllByRole('radio');
    fireEvent.click(stars[3]); // Click 4th star
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('has no focusable rating choices when not interactive', async () => {
    render(<><StarRating value={3} /><button>After rating</button></>);
    await userEvent.setup().tab();
    expect(screen.getByRole('button', { name: 'After rating' })).toHaveFocus();
  });

  // a11y (#9048)
  it('names each interactive star radio', () => {
    render(<StarRating value={2} interactive onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Rate 1 star' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Rate 3 stars' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Rate 5 stars' })).toBeDefined();
  });

  it('groups interactive stars in a labelled radiogroup', () => {
    render(<StarRating value={2} interactive onChange={vi.fn()} />);
    expect(screen.getByRole('radiogroup', { name: 'Rate this game' })).toBeDefined();
  });

  it('checks only the selected rating rather than every filled artwork star', () => {
    render(<StarRating value={3} interactive onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Rate 3 stars' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Rate 2 stars' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Rate 4 stars' })).not.toBeChecked();
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
