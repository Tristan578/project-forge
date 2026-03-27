import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Accordion } from '../Accordion';
import { THEME_NAMES } from '../../tokens';

const items = [
  { id: 'item1', title: 'Section 1', content: <div>Content 1</div> },
  { id: 'item2', title: 'Section 2', content: <div>Content 2</div> },
];

describe('Accordion', () => {
  it('renders accordion item titles', () => {
    render(<Accordion items={items} />);
    expect(screen.getByText('Section 1')).not.toBeNull();
    expect(screen.getByText('Section 2')).not.toBeNull();
  });

  it('content hidden by default', () => {
    render(<Accordion items={items} />);
    expect(screen.queryByText('Content 1')).toBeNull();
  });

  it('expands on click', () => {
    render(<Accordion items={items} />);
    fireEvent.click(screen.getByText('Section 1'));
    expect(screen.getByText('Content 1')).not.toBeNull();
  });

  it('collapses on second click', () => {
    render(<Accordion items={items} />);
    fireEvent.click(screen.getByText('Section 1'));
    fireEvent.click(screen.getByText('Section 1'));
    expect(screen.queryByText('Content 1')).toBeNull();
  });

  it('triggers have aria-expanded', () => {
    render(<Accordion items={items} />);
    const triggers = screen.getAllByRole('button');
    expect(triggers[0].getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(triggers[0]);
    expect(triggers[0].getAttribute('aria-expanded')).toBe('true');
  });

  it.each(THEME_NAMES)('renders without error in %s theme', (theme) => {
    document.documentElement.setAttribute('data-sf-theme', theme);
    const { container } = render(<Accordion items={items} />);
    expect(container.firstChild).not.toBeNull();
    const allClasses = Array.from(container.querySelectorAll('[class]'))
      .flatMap((el) => (el.getAttribute('class') ?? '').split(' '));
    const leaks = allClasses.filter((c) => /zinc-|stone-|slate-/.test(c));
    expect(leaks, `Hardcoded primitives found: ${leaks.join(', ')}`).toHaveLength(0);
  });
});
