import { createRef } from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ScrollArea } from '../ScrollArea';
import { THEME_NAMES } from '../../tokens';

describe('ScrollArea', () => {
  it('renders children', () => {
    const { container } = render(
      <ScrollArea>
        <div>Scrollable content</div>
      </ScrollArea>
    );
    expect(container.textContent).toContain('Scrollable content');
  });

  it('renders with overflow-auto', () => {
    const { container } = render(<ScrollArea>Content</ScrollArea>);
    const scrollArea = container.firstChild as HTMLElement;
    expect(scrollArea?.className).toContain('overflow-auto');
  });

  it('contains overscroll so a drag that hits the end does not chain into document scroll (PF-1032 / #9052 AC5)', () => {
    const { container } = render(<ScrollArea>Content</ScrollArea>);
    const scrollArea = container.firstChild as HTMLElement;
    expect(scrollArea?.className).toContain('[overscroll-behavior:contain]');
  });

  it('hands its ref the scroll container element itself', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(<ScrollArea ref={ref}>Content</ScrollArea>);
    expect(ref.current).not.toBeNull();
    expect(ref.current).toBe(container.firstChild);
  });

  it('accepts height prop', () => {
    const { container } = render(
      <ScrollArea height="200px">Content</ScrollArea>
    );
    const scrollArea = container.firstChild as HTMLElement;
    expect(scrollArea?.style.height).toBe('200px');
  });

  it.each(THEME_NAMES)('renders without error in %s theme', (theme) => {
    document.documentElement.setAttribute('data-sf-theme', theme);
    const { container } = render(<ScrollArea>Content</ScrollArea>);
    expect(container.firstChild).not.toBeNull();
    const allClasses = Array.from(container.querySelectorAll('[class]'))
      .flatMap((el) => el.className.split(' '));
    const leaks = allClasses.filter((c) => /zinc-|stone-|slate-/.test(c));
    expect(leaks, `Hardcoded primitives found: ${leaks.join(', ')}`).toHaveLength(0);
  });
});
